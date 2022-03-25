// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.7.5;

/// @title IFactoryStorage Interface
interface IFactoryStorage {
    function pushBond(
        address _payoutToken,
        address _principleToken,
        address _customTreasury,
        address _customBond,
        address _initialOwner
    ) external returns (address _treasury, address _bond);
}
