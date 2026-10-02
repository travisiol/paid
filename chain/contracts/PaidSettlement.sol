// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
}

/**
 * PAID settlement.
 *
 * A payer settles an invoice in USDG in one transaction. The contract sends
 * the dollar part to the recipient as USDG and converts the rest into the
 * recipient's chosen stock tokens through the swap router, delivered straight
 * to the recipient.
 *
 * No owner, no admin, no fee, no upgrade path. The contract never keeps
 * funds: what a route does not spend goes back to the payer.
 *
 * An invoice is identified by the hash of its terms (id, recipient, dollar
 * part, tokens and the USDG assigned to each). A set of terms can be settled
 * once; `receipts` is the public record a site reads to show "paid".
 */
contract PaidSettlement {
    struct Swap {
        address token; // stock token the recipient receives
        uint256 amountIn; // USDG converted
        uint256 minOut; // least amount of `token` the recipient must receive
        bytes data; // router calldata: swaps `amountIn` USDG held by this contract, pays `token` to the recipient
    }

    struct Receipt {
        address payer;
        uint64 paidAt;
    }

    address public immutable usdg;
    address public immutable router;

    mapping(bytes32 terms => Receipt) public receipts;

    uint256 private entered = 1;

    event InvoicePaid(
        bytes32 indexed terms,
        bytes32 indexed invoiceId,
        address indexed recipient,
        address payer,
        uint256 total,
        uint256 usdgToRecipient
    );
    event StockDelivered(bytes32 indexed terms, address indexed token, uint256 amountIn, uint256 amountOut);

    error Reentered();
    error BadRecipient();
    error BadSwap();
    error NothingToPay();
    error AlreadyPaid();
    error TransferFailed();
    error SwapFailed();
    error DeliveredTooLittle(address token, uint256 delivered, uint256 minOut);

    constructor(address usdg_, address router_) {
        usdg = usdg_;
        router = router_;
    }

    function termsHash(
        bytes32 invoiceId,
        address recipient,
        uint256 usdgToRecipient,
        address[] memory tokens,
        uint256[] memory amountsIn
    ) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), invoiceId, recipient, usdgToRecipient, tokens, amountsIn));
    }

    /**
     * Pay an invoice. The caller must have approved this contract for the
     * invoice total (`usdgToRecipient` plus every `amountIn`).
     */
    function pay(bytes32 invoiceId, address recipient, uint256 usdgToRecipient, Swap[] calldata swaps) external returns (bytes32 terms) {
        if (entered != 1) revert Reentered();
        entered = 2;

        if (recipient == address(0) || recipient == address(this)) revert BadRecipient();

        uint256 count = swaps.length;
        address[] memory tokens = new address[](count);
        uint256[] memory amountsIn = new uint256[](count);
        uint256 total = usdgToRecipient;
        for (uint256 i; i < count; ++i) {
            if (swaps[i].token == usdg || swaps[i].token == address(0) || swaps[i].amountIn == 0 || swaps[i].minOut == 0) revert BadSwap();
            tokens[i] = swaps[i].token;
            amountsIn[i] = swaps[i].amountIn;
            total += swaps[i].amountIn;
        }
        if (total == 0) revert NothingToPay();

        terms = termsHash(invoiceId, recipient, usdgToRecipient, tokens, amountsIn);
        if (receipts[terms].paidAt != 0) revert AlreadyPaid();
        receipts[terms] = Receipt(msg.sender, uint64(block.timestamp));

        uint256 held = IERC20(usdg).balanceOf(address(this));
        _call(usdg, abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), total));
        if (usdgToRecipient != 0) _call(usdg, abi.encodeWithSignature("transfer(address,uint256)", recipient, usdgToRecipient));

        for (uint256 i; i < count; ++i) _convert(terms, recipient, swaps[i]);

        // Whatever the routes did not spend goes back to the payer. Reverts if a route took more than it was given.
        uint256 left = IERC20(usdg).balanceOf(address(this)) - held;
        if (left != 0) _call(usdg, abi.encodeWithSignature("transfer(address,uint256)", msg.sender, left));

        emit InvoicePaid(terms, invoiceId, recipient, msg.sender, total, usdgToRecipient);
        entered = 1;
    }

    /** Run one route and check what the recipient actually received. */
    function _convert(bytes32 terms, address recipient, Swap calldata swap) private {
        uint256 before = IERC20(swap.token).balanceOf(recipient);

        _call(usdg, abi.encodeWithSignature("approve(address,uint256)", router, swap.amountIn));
        (bool ok, bytes memory reason) = router.call(swap.data);
        if (!ok) {
            if (reason.length == 0) revert SwapFailed();
            assembly {
                revert(add(reason, 32), mload(reason))
            }
        }
        _call(usdg, abi.encodeWithSignature("approve(address,uint256)", router, 0));

        uint256 delivered = IERC20(swap.token).balanceOf(recipient) - before;
        if (delivered < swap.minOut) revert DeliveredTooLittle(swap.token, delivered, swap.minOut);
        emit StockDelivered(terms, swap.token, swap.amountIn, delivered);
    }

    /** ERC-20 call that tolerates tokens returning nothing. */
    function _call(address token, bytes memory data) private {
        (bool ok, bytes memory result) = token.call(data);
        if (!ok || (result.length != 0 && !abi.decode(result, (bool)))) revert TransferFailed();
    }
}
