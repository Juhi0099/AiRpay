// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * NoSignal vault for Monad Testnet.
 *
 * Security notes:
 * - Native MON is handled directly and balances are tracked in the contract.
 * - Payers reserve each offline voucher amount onchain, keyed by its nonce,
 *   before signing it. Settlement cannot spend another voucher's reservation.
 * - Offline acceptance is not final proof of settlement.
 * - This is intentionally non-upgradeable and uses explicit validation for every
 *   voucher to keep the settlement engine predictable.
 */
contract VaultEscrow {
    bytes32 private constant VOUCHER_TYPEHASH =
        keccak256("Voucher(address payer,address merchant,uint256 amount,uint256 nonce,uint256 expiry)");

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    struct Voucher {
        address payer;
        address merchant;
        uint256 amount;
        uint256 nonce;
        uint256 expiry;
        bytes signature;
    }

    enum Reason {
        None,
        Expired,
        Replay,
        InvalidSignature,
        InsufficientFunds,
        ZeroAddress,
        ZeroAmount,
        InvalidParticipants,
        InvalidDomain,
        ReservationMismatch
    }

    error ZeroAmount();
    error InsufficientBalance();
    error InsufficientAvailableBalance();
    error InvalidVoucher();
    error InvalidAddress();
    error NotOwner();
    error TransferFailed();
    error BatchTooLarge();
    error InvalidSignature();
    error ReplayDetected();
    error ExpiredVoucher();
    error Unauthorized();
    error InvalidReservation();

    uint256 private constant _REENTRANCY_UNLOCKED = 1;
    uint256 private constant _REENTRANCY_LOCKED = 2;
    uint256 public constant MAX_BATCH = 100;

    address public owner;
    mapping(address => uint256) public balances;
    mapping(address => uint256) public reservedBalance;
    mapping(address => uint256) public voucherReservedBalance;
    mapping(address => mapping(uint256 => uint256)) public voucherReservation;
    mapping(address => mapping(uint256 => uint256)) public voucherReservationExpiry;
    mapping(address => mapping(uint256 => bool)) public nonceUsed;
    bytes32 private immutable _domainSeparator;
    uint256 private _reentrancyStatus;

    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, address indexed to, uint256 amount);
    event ReservationCreated(address indexed account, uint256 amount);
    event ReservationReleased(address indexed account, uint256 amount);
    event VoucherReservationCreated(address indexed account, uint256 indexed nonce, uint256 amount, uint256 expiry);
    event VoucherReservationReleased(address indexed account, uint256 indexed nonce, uint256 amount);
    event VoucherSettled(
        address indexed payer,
        address indexed merchant,
        uint256 amount,
        uint256 nonce,
        bytes32 indexed voucherHash
    );
    event VoucherRejected(address indexed payer, address indexed merchant, uint256 amount, uint256 nonce, uint8 reason);
    event Payment(address indexed payer, address indexed merchant, uint256 amount, uint256 nonce);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (_reentrancyStatus == _REENTRANCY_LOCKED) revert Unauthorized();
        _reentrancyStatus = _REENTRANCY_LOCKED;
        _;
        _reentrancyStatus = _REENTRANCY_UNLOCKED;
    }

    constructor() {
        owner = msg.sender;
        _domainSeparator = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes("NoSignalVault")),
                keccak256(bytes("1.0.0")),
                block.chainid,
                address(this)
            )
        );
        _reentrancyStatus = _REENTRANCY_UNLOCKED;
    }

    receive() external payable {
        deposit();
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparator;
    }

    function deposit() public payable nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        balances[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function reserveFunds(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 available = balances[msg.sender] - reservedBalance[msg.sender];
        if (available < amount) revert InsufficientBalance();
        reservedBalance[msg.sender] += amount;
        emit ReservationCreated(msg.sender, amount);
    }

    function releaseReservation(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 unassigned = reservedBalance[msg.sender] - voucherReservedBalance[msg.sender];
        if (amount > unassigned) revert InsufficientBalance();
        reservedBalance[msg.sender] -= amount;
        emit ReservationReleased(msg.sender, amount);
    }

    function reserveVoucher(uint256 nonce, uint256 amount, uint256 expiry) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (expiry <= block.timestamp) revert ExpiredVoucher();
        if (nonceUsed[msg.sender][nonce] || voucherReservation[msg.sender][nonce] != 0) {
            revert InvalidReservation();
        }

        uint256 available = balances[msg.sender] - reservedBalance[msg.sender];
        if (available < amount) revert InsufficientBalance();

        voucherReservation[msg.sender][nonce] = amount;
        voucherReservationExpiry[msg.sender][nonce] = expiry;
        reservedBalance[msg.sender] += amount;
        voucherReservedBalance[msg.sender] += amount;
        emit VoucherReservationCreated(msg.sender, nonce, amount, expiry);
    }

    function cancelVoucherReservation(uint256 nonce) external nonReentrant {
        uint256 amount = voucherReservation[msg.sender][nonce];
        if (amount == 0) revert InvalidReservation();

        delete voucherReservation[msg.sender][nonce];
        delete voucherReservationExpiry[msg.sender][nonce];
        reservedBalance[msg.sender] -= amount;
        voucherReservedBalance[msg.sender] -= amount;
        nonceUsed[msg.sender][nonce] = true;
        emit VoucherReservationReleased(msg.sender, nonce, amount);
    }

    function releaseExpiredVoucherReservation(address payer, uint256 nonce) external nonReentrant {
        uint256 amount = voucherReservation[payer][nonce];
        if (amount == 0 || voucherReservationExpiry[payer][nonce] > block.timestamp) {
            revert InvalidReservation();
        }

        delete voucherReservation[payer][nonce];
        delete voucherReservationExpiry[payer][nonce];
        reservedBalance[payer] -= amount;
        voucherReservedBalance[payer] -= amount;
        emit VoucherReservationReleased(payer, nonce, amount);
    }

    function voucherDigest(Voucher calldata voucher) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(VOUCHER_TYPEHASH, voucher.payer, voucher.merchant, voucher.amount, voucher.nonce, voucher.expiry)
        );
        return _hashTypedDataV4(structHash);
    }

    function verifyVoucher(Voucher calldata voucher) public view returns (bool) {
        (bool valid, ) = _validateVoucher(voucher);
        return valid;
    }

    function batchSettle(Voucher[] calldata vouchers) external nonReentrant {
        if (vouchers.length == 0 || vouchers.length > MAX_BATCH) revert BatchTooLarge();

        for (uint256 i; i < vouchers.length; ++i) {
            Voucher calldata voucher = vouchers[i];
            (bool valid, uint8 reason) = _validateVoucher(voucher);
            if (!valid) {
                emit VoucherRejected(voucher.payer, voucher.merchant, voucher.amount, voucher.nonce, reason);
                continue;
            }

            nonceUsed[voucher.payer][voucher.nonce] = true;

            uint256 reservation = voucherReservation[voucher.payer][voucher.nonce];
            if (reservation != 0) {
                delete voucherReservation[voucher.payer][voucher.nonce];
                delete voucherReservationExpiry[voucher.payer][voucher.nonce];
                reservedBalance[voucher.payer] -= voucher.amount;
                voucherReservedBalance[voucher.payer] -= voucher.amount;
            }

            balances[voucher.payer] -= voucher.amount;
            balances[voucher.merchant] += voucher.amount;

            bytes32 voucherHash = keccak256(
                abi.encode(voucher.payer, voucher.merchant, voucher.amount, voucher.nonce, voucher.expiry)
            );
            emit VoucherSettled(voucher.payer, voucher.merchant, voucher.amount, voucher.nonce, voucherHash);
            emit Payment(voucher.payer, voucher.merchant, voucher.amount, voucher.nonce);
        }
    }

    function withdraw(uint256 amount, address payable to) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert InvalidAddress();

        uint256 available = balances[msg.sender] - reservedBalance[msg.sender];
        if (available < amount) revert InsufficientAvailableBalance();

        balances[msg.sender] -= amount;
        (bool success, ) = to.call{value: amount}("");
        if (!success) {
            balances[msg.sender] += amount;
            revert TransferFailed();
        }
        emit Withdrawn(msg.sender, to, amount);
    }

    function _validateVoucher(Voucher calldata voucher) internal view returns (bool, uint8) {
        if (voucher.payer == address(0) || voucher.merchant == address(0)) {
            return (false, uint8(Reason.ZeroAddress));
        }
        if (voucher.payer == voucher.merchant) {
            return (false, uint8(Reason.InvalidParticipants));
        }
        if (voucher.amount == 0) {
            return (false, uint8(Reason.ZeroAmount));
        }
        if (voucher.expiry <= block.timestamp) {
            return (false, uint8(Reason.Expired));
        }
        if (nonceUsed[voucher.payer][voucher.nonce]) {
            return (false, uint8(Reason.Replay));
        }

        uint256 reservation = voucherReservation[voucher.payer][voucher.nonce];
        if (reservation != 0) {
            if (
                reservation != voucher.amount ||
                voucherReservationExpiry[voucher.payer][voucher.nonce] != voucher.expiry
            ) {
                return (false, uint8(Reason.ReservationMismatch));
            }
        } else {
            uint256 available = balances[voucher.payer] - reservedBalance[voucher.payer];
            if (available < voucher.amount) {
                return (false, uint8(Reason.InsufficientFunds));
            }
        }

        if (balances[voucher.payer] < voucher.amount) {
            return (false, uint8(Reason.InsufficientFunds));
        }

        address recovered = _recoverSigner(voucherDigest(voucher), voucher.signature);
        if (recovered != voucher.payer) {
            return (false, uint8(Reason.InvalidSignature));
        }

        return (true, 0);
    }

    function _hashTypedDataV4(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator, structHash));
    }

    function _recoverSigner(bytes32 digest, bytes memory signature) internal pure returns (address) {
        if (signature.length != 65) return address(0);

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }

        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);

        return ecrecover(digest, v, r, s);
    }
}
