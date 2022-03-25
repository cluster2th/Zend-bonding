

// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.7.5;

import "../types/BondOwnable.sol";
import "../libraries/SafeMath.sol";
import "./CustomBond.sol";
import "./CustomTreasury.sol";
import "./Fees.sol";
import "../interfaces/IFactoryStorage.sol";

contract Factory is BondOwnable {    
    using SafeMath for uint256;

    address immutable public TREASURY;
    address immutable public FACTORY_STORAGE;
    address immutable public SUBSIDY_ROUTER;
    address immutable public HELPER;
    address immutable public FEES;

    event BondCreation(address treasury, address bond, address _initialOwner);   

    constructor(
        address _treasury,
        address _factoryStorage,
        address _subsidyRouter,
        address _helper,
        address _fees
    ) {
        require(_treasury != address(0), "Factory: treasury bad address");
        TREASURY = _treasury;
        require(_factoryStorage != address(0), "Factory: factoryStorage bad address");
        FACTORY_STORAGE = _factoryStorage;
        require(_subsidyRouter != address(0), "Factory: subsidyRouter bad address");
        SUBSIDY_ROUTER = _subsidyRouter;
        require(_helper != address(0), "Factory: helper bad address");
        HELPER = _helper;
        require(_fees != address(0), "Factory: Fees bad address");
        FEES = _fees;
    }

    /* ======== POLICY FUNCTIONS ======== */

    /**
        @notice deploys custom treasury and custom bond contracts and returns address of both
        @param _payoutToken address
        @param _principleToken address
        @param _initialOwner address
        @return _treasury address
        @return _bond address
     */
    function createBondAndTreasury(
        address _payoutToken,
        address _principleToken,
        address _initialOwner
    ) external returns (address _treasury, address _bond) {
        
        uint256[] memory fees = Fees(FEES).getFees();
        require(fees.length > 0, "createBondAndTreasury: fees must be setup");

        CustomTreasury customTreasury = new CustomTreasury(_payoutToken, _initialOwner);
        CustomBond customBond = new CustomBond(
            address(customTreasury), 
            _payoutToken, 
            _principleToken, 
            TREASURY, 
            SUBSIDY_ROUTER, 
            _initialOwner, 
            HELPER,
            FEES
        );

        emit BondCreation(address(customTreasury), address(customBond), _initialOwner);                

        return IFactoryStorage(FACTORY_STORAGE).pushBond(
            _payoutToken, 
            _principleToken, 
            address(customTreasury), 
            address(customBond), 
            _initialOwner
        );
    }

    /**
        @notice deploys custom treasury and custom bond contracts and returns address of both
        @param _payoutToken address
        @param _principleToken address
        @param _customTreasury address
        @param _initialOwner address
        @return _treasury address
        @return _bond address
     */
    function createBond(
        address _payoutToken,
        address _principleToken,
        address _customTreasury,
        address _initialOwner
    ) external returns (address _treasury, address _bond) {

        uint256[] memory fees = Fees(FEES).getFees();
        require(fees.length > 0, "createBond: fees must be setup");

        CustomBond bond = new CustomBond(
            _customTreasury, 
            _payoutToken, 
            _principleToken, 
            _customTreasury, 
            SUBSIDY_ROUTER, 
            _initialOwner, 
            HELPER,
            FEES
        );

        emit BondCreation(_customTreasury, address(bond), _initialOwner);

        return
            IFactoryStorage(FACTORY_STORAGE).pushBond(
                _payoutToken,
                _principleToken,
                _customTreasury,
                address(bond),
                _initialOwner
            );
    }
}
