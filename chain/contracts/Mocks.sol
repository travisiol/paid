// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/** Test doubles for chain/test.cjs. Never deployed anywhere real. */
contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

interface IPay {
    struct Swap {
        address token;
        uint256 amountIn;
        uint256 minOut;
        bytes data;
    }

    function pay(bytes32, address, uint256, Swap[] calldata) external returns (bytes32);
}

contract MockRouter {
    /** Takes `spend` of `tokenIn` from the caller and mints `out` of `tokenOut` to `to`. */
    function swap(address tokenIn, uint256 spend, address tokenOut, uint256 out, address to) external {
        MockToken(tokenIn).transferFrom(msg.sender, address(this), spend);
        MockToken(tokenOut).mint(to, out);
    }

    function fail() external pure {
        revert("route failed");
    }

    /** Tries to re-enter the settlement contract from inside a swap. */
    function reenter(address settlement) external {
        IPay(settlement).pay(bytes32(0), address(1), 0, new IPay.Swap[](0));
    }
}
