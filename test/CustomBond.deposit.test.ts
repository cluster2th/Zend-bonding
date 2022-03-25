import {expect} from './chai-setup';
import {ethers, deployments} from 'hardhat';
import {setupUsers, config, randomAddress} from './utils';
import {Factory, FactoryStorage, Helper, SubsidyRouter, MockToken} from '../typechain';
import { BigNumber, utils } from 'ethers';
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
import { Fees } from '../typechain/Fees';
const ERC20 = require('./utils/ERC20.json');

// TEST : Rinkeby testnet
const setup = deployments.createFixture(async () => {
  await deployments.fixture('Factory');
  
  const contracts = {
    FactoryContract: <Factory>await ethers.getContract('Factory'),
    FactoryStorageContract: <FactoryStorage>await ethers.getContract('FactoryStorage'),
    SubsidyRouterContract: <SubsidyRouter>await ethers.getContract('SubsidyRouter'),
    HelperContract: <Helper>await ethers.getContract('Helper'),
    FeesContract: <Fees>await ethers.getContract('Fees'),
    MockTokenContract: <MockToken>await ethers.getContract('MockToken'),
  };  
  
  const [deployer, dao, user] = await ethers.getSigners();
  const private_key = process.env.PRIVATE_KEY;

  return {
    ...contracts, deployer, dao, user, private_key
  };
});

const convert = (addr: string) => {
  return addr.toLowerCase();
}

describe('CustomBond', async function () {
  beforeEach(async function () {
    const {
      deployer, dao, user,
      FactoryContract,
      FeesContract,
      MockTokenContract
    } = await setup();

    const mToken = await MockTokenContract.deployed();
    this.principleTokenAddr = mToken.address;
    this.deployerAddr = deployer.address;

    await FeesContract.connect(dao).setTiersAndFees(config.tierCeilings, config.fees, {from: dao.address});

    const tx = await FactoryContract.createBondAndTreasury(
      config.usdcAdress, 
      mToken.address, 
      deployer.address, 
    )

    const TreasuryFactory = await ethers.getContractFactory('CustomTreasury');
    const BondFactory = await ethers.getContractFactory('CustomBond');

    let events: any = [];
    events = (await tx.wait()).events;
    
    this.customTreasuryAddr = events[0].args.treasury;
    this.customBondAddr = events[0].args.bond;
    this.TreasuryContract = TreasuryFactory.attach(this.customTreasuryAddr);
    this.BondContract = BondFactory.attach(this.customBondAddr);
  });
    
  it('initializeBond', async function () {
    const {deployer} = await setup();
    const controlVariable = 0;
    const vestingTerm = 2;
    const minimumPrice = 2;
    const maxPayout = 2;
    const maxDebt = 2;
    const initialDebt = 2;
    const txInit = await this.BondContract.connect(deployer).initializeBond(
      controlVariable,
      vestingTerm,
      minimumPrice,
      maxPayout,
      maxDebt,
      initialDebt,
      {from: deployer.address}
    )
  }); 
  
  it('setAdjustment', async function () {
    const {deployer} = await setup();
    const addition = true;
    const increment = 10;
    const target = 2000;
    const buffer = 100;
    this.BondContract.connect(deployer).setAdjustment(
      addition,
      increment,
      target,
      buffer,
      {from: deployer.address}
    );
  }); 
  
  it('setLPtokenAsFee', async function () {
    const [deployer, user] = await ethers.getSigners();
    await this.BondContract.connect(deployer).setLPtokenAsFee(true, {from:deployer.address});
    expect(await this.BondContract.connect(deployer).lpTokenAsFeeFlag({from:deployer.address})).to.true
    await this.BondContract.setLPtokenAsFee(false);
    expect(await this.BondContract.lpTokenAsFeeFlag()).to.false

    await expect(
      this.BondContract.connect(user).setLPtokenAsFee({from: user.address})
    ).to.be.revertedWith('Ownable: caller is not the owner')
  });

  it('changeOlyTreasury', async function () {
    await expect(
      this.BondContract.changeOlyTreasury(await randomAddress())
    ).to.be.revertedWith('Only DAO')
  });
});

describe('CustomBond-deposit with principleToken', async function () {
  it('deposit(deployer)', async function () {      
    const {
      deployer, user, dao,
      FactoryContract,
      FeesContract,
      MockTokenContract
    } = await setup();

    const principleToken = await MockTokenContract.deployed();

    await FeesContract.connect(dao).setTiersAndFees(config.tierCeilings, config.fees, {from: dao.address});

    const tx = await FactoryContract.connect(deployer).createBondAndTreasury(
      config.usdcAdress, //payoutToken
      principleToken.address, 
      deployer.address, 
      {from: deployer.address}
    )

    const TreasuryFactory = await ethers.getContractFactory('CustomTreasury');
    const BondFactory = await ethers.getContractFactory('CustomBond');

    let events: any = [];
    events = (await tx.wait()).events; 
    const customTreasuryAddr = events[0].args.treasury;
    const customBondAddr = events[0].args.bond;
    const TreasuryContract = TreasuryFactory.attach(customTreasuryAddr);
    const BondContract = BondFactory.attach(customBondAddr);

    // Policy(deployer) set bond terms    
    // await BondContract.connect(deployer).setBondTerms(0, 20000, {from: deployer.address})//_input >= 10000, terms.vestingTerm
    // await BondContract.connect(deployer).setBondTerms(1, 150, {from: deployer.address})  //_input <= 1000,  terms.maxPayout
    // await BondContract.connect(deployer).setBondTerms(2, 2000, {from: deployer.address}) //                 terms.maxDebt

    // Policy(deployer) initialization bond
    const controlVariable = BigNumber.from(82500);
    const vestingTerm = BigNumber.from(46200);
    const minimumPrice = BigNumber.from(36760);
    const maxPayout = BigNumber.from(400);
    const maxDebt = utils.parseEther('1250');
    const initialDebt = utils.parseEther('400')    

    await expect(BondContract.connect(deployer).initializeBond(0, vestingTerm, minimumPrice, maxPayout, maxDebt, initialDebt, {from: deployer.address})).to.be.revertedWith('initializeBond: controlVariable must be 0 for initialization');

    await expect(BondContract.connect(deployer).initializeBond(controlVariable, 1000, minimumPrice, maxPayout, maxDebt, initialDebt, {from: deployer.address})).to.be.revertedWith('Vesting must be longer than 36 hours');

    // Policy(deployer) initialization bond again
    await BondContract.connect(deployer).initializeBond(controlVariable, vestingTerm, minimumPrice, maxPayout, maxDebt, initialDebt, {from: deployer.address})

    // set adjustment
    // const addition = true;
    // const increment = 10;
    // const target = 2000;
    // const buffer = 100;
    // await BondContract.connect(deployer).setAdjustment(addition,  increment, target, buffer, {from: deployer.address})
        
    //Approve(principleToken) to deposit in frontend(user)
    const tokenSupply = await principleToken.totalSupply();//1e+26
    await principleToken.connect(deployer).approve(BondContract.address, tokenSupply, {from: deployer.address});
    
    // Transfer(payoutToken) to TreasuryContract for testing
    const payoutTokenContract = new ethers.Contract(config.usdcAdress, JSON.stringify(ERC20), ethers.provider)
    const transferAmount = utils.parseUnits('40000', await payoutTokenContract.decimals());//33333333333
    await payoutTokenContract.connect(deployer).transfer(TreasuryContract.address, transferAmount, {from: deployer.address});
    
    // Policy(deployer) allow/unallow to deposit from user
    // await TreasuryContract.connect(deployer).toggleBondContract(BondContract.address, {from: deployer.address})

    // deposit()
    const amount = utils.parseUnits('2', await principleToken.decimals()); 
    const maxPrice = BigNumber.from(50000);   
    const txd = await BondContract.connect(deployer).deposit(amount, maxPrice, user.address, {from:deployer.address});
    events = (await txd.wait()).events;      
    const bondCreatedEvent = events[7].args;
    const deposit = Number(BigNumber.from(bondCreatedEvent.deposit))
    const payout = Number(BigNumber.from(bondCreatedEvent.payout))
    const expires = Number(BigNumber.from(bondCreatedEvent.expires))
    expect(Number(amount)).to.equal(deposit);

    const blockNum = await ethers.provider.getBlockNumber()
    const expiresSol = BigNumber.from(blockNum).add(vestingTerm);
    expect(Number(expiresSol)).to.equal(expires);
    
    const bondPriceChangedEvent = events[8].args;
    const internalPrice = Number(BigNumber.from(bondPriceChangedEvent.internalPrice))
    const debtRatio = Number(BigNumber.from(bondPriceChangedEvent.debtRatio))

    const debtRatioSol = await BondContract.connect(deployer).debtRatio({from:deployer.address});
    expect(Number(debtRatioSol)).to.equal(debtRatio)

    // debtRatio=0 so that price = terms.minimumPrice;
    const priceSol = minimumPrice;
    expect(Number(priceSol)).to.equal(internalPrice)
  });

  it('deposit(user)', async function () {      
    const {
      deployer, user, dao,
      FactoryContract,
      FeesContract,
      MockTokenContract
    } = await setup();

    // const myBalance = await ethers.provider.getBalance(deployer.address)

    const principleToken = await MockTokenContract.deployed();

    await FeesContract.connect(dao).setTiersAndFees(config.tierCeilings, config.fees, {from: dao.address});

    const tx = await FactoryContract.connect(user).createBondAndTreasury(
      config.usdcAdress, 
      principleToken.address, 
      user.address, 
      {from:user.address}
    )

    const TreasuryFactory = await ethers.getContractFactory('CustomTreasury');
    const BondFactory = await ethers.getContractFactory('CustomBond');
    let events: any = [];
    events = (await tx.wait()).events;    
    const customTreasuryAddr = events[0].args.treasury;
    const customBondAddr = events[0].args.bond;
    const TreasuryContract = TreasuryFactory.attach(customTreasuryAddr);
    const BondContract = BondFactory.attach(customBondAddr);

    // set bond terms
    // await BondContract.connect(user).setBondTerms(0, 20000, {from: user.address})//_input >= 10000, terms.vestingTerm
    // await BondContract.connect(user).setBondTerms(1, 150, {from: user.address})  //_input <= 1000,  terms.maxPayout
    // await BondContract.connect(user).setBondTerms(2, 2000, {from: user.address}) //                 terms.maxDebt

    // initialization bond
    const controlVariable = BigNumber.from(82500);
    const vestingTerm = BigNumber.from(46200);
    const minimumPrice = BigNumber.from(36760);
    const maxPayout = BigNumber.from(400);
    const maxDebt = utils.parseEther('1250');
    const initialDebt = utils.parseEther('400')
    await BondContract.connect(user).initializeBond(controlVariable, vestingTerm, minimumPrice, maxPayout, maxDebt, initialDebt, {from:user.address})
    
    // deposit
    // payoutTokenContract=USDC(decimals:6), 
    // principleToken=tokenContract(decimals:18)     
    const payoutTokenContract = new ethers.Contract(config.usdcAdress, JSON.stringify(ERC20), ethers.provider)
    await payoutTokenContract.connect(deployer).transfer(user.address, utils.parseUnits('50000', await payoutTokenContract.decimals()), {from: deployer.address});
    
    await principleToken.connect(deployer).transfer(user.address, utils.parseUnits('20', await principleToken.decimals()), {from: deployer.address});
            
    //Approve(principleToken) to deposit in frontend(user)
    const tokenSupply = await principleToken.totalSupply();//1e+26
    await principleToken.connect(user).approve(BondContract.address, tokenSupply, {from: user.address});
    
    const amount = utils.parseEther('0.1');
    const maxPrice = BigNumber.from(50000);//>= nativePrice(37682)
    
    // Transfer(payoutToken) to TreasuryContract for testing
    const transferAmount = utils.parseUnits('50000', await payoutTokenContract.decimals());//
    await payoutTokenContract.connect(user).transfer(TreasuryContract.address, transferAmount, {from: user.address});

    // Calling deposit()
    const txd = await BondContract.connect(user).deposit(amount, maxPrice, user.address, {from:user.address});
    events = (await txd.wait()).events;   
    const bondCreatedEvent = events[7].args;
    const deposit = Number(BigNumber.from(bondCreatedEvent.deposit))
    const payout = Number(BigNumber.from(bondCreatedEvent.payout))
    const expires = Number(BigNumber.from(bondCreatedEvent.expires))
    expect(Number(amount)).to.equal(deposit);

    const blockNum = await ethers.provider.getBlockNumber()
    const expiresSol = BigNumber.from(blockNum).add(vestingTerm);
    expect(Number(expiresSol)).to.equal(expires);
    
    const bondPriceChangedEvent = events[8].args;
    const internalPrice = Number(BigNumber.from(bondPriceChangedEvent.internalPrice))
    const debtRatio = Number(BigNumber.from(bondPriceChangedEvent.debtRatio))

    const debtRatioSol = await BondContract.connect(deployer).debtRatio({from:deployer.address});
    expect(Number(debtRatioSol)).to.equal(debtRatio)

    // debtRatio=0 so that price = terms.minimumPrice;
    const priceSol = minimumPrice;
    expect(Number(priceSol)).to.equal(internalPrice)
  });
});

describe('CustomBond-deposit with one Asset-0', async function () {
  it('deposit(user) with one Asset, lpTokenAsFeeFlag(true)', async function () {      
    const {
      deployer, user, dao,
      FactoryContract,
      FeesContract
    } = await setup();

    // deployer=0xb10bcC8B508174c761CFB1E7143bFE37c4fBC3a1 
    // user=0x6fD89350A94A02B003E638c889b54DAB0E251655
    // const myBalance = await ethers.provider.getBalance(deployer.address)
    // usdcAdress: "0xeb8f08a975ab53e34d8a0330e0d34de942c95926",//usdc in rinkeby = decimals=6
    // daiAddress: "0x5592ec0cfb4dbc12d3ab100b257153436a1f0fea",//Dai in rinkeby       = decimals=18

    await FeesContract.connect(dao).setTiersAndFees(config.tierCeilings, config.fees, {from: dao.address});

    const tx = await FactoryContract.connect(user).createBondAndTreasury(
      config.usdcAdress, 
      config.daiAddress,
      user.address, 
      {from:user.address}
    )

    const TreasuryFactory = await ethers.getContractFactory('CustomTreasury');
    const BondFactory = await ethers.getContractFactory('CustomBond');
    let events: any = [];
    events = (await tx.wait()).events;    
    const customTreasuryAddr = events[0].args.treasury;
    const customBondAddr = events[0].args.bond;
    const TreasuryContract = TreasuryFactory.attach(customTreasuryAddr);
    const BondContract = BondFactory.attach(customBondAddr);

    // set bond terms
    // await BondContract.connect(user).setBondTerms(0, 20000, {from: user.address})//_input >= 10000, terms.vestingTerm
    // await BondContract.connect(user).setBondTerms(1, 150, {from: user.address})  //_input <= 1000,  terms.maxPayout
    // await BondContract.connect(user).setBondTerms(2, 2000, {from: user.address}) //                 terms.maxDebt

    // initialization bond
    const controlVariable = BigNumber.from(82500);
    const vestingTerm = BigNumber.from(46200);
    const minimumPrice = BigNumber.from(36760);
    const maxPayout = BigNumber.from(400);
    const maxDebt = utils.parseEther('1250');
    const initialDebt = utils.parseEther('400')
    await BondContract.connect(user).initializeBond(controlVariable, vestingTerm, minimumPrice, maxPayout, maxDebt, initialDebt, {from:user.address})
     
    const payoutTokenContract = new ethers.Contract(config.usdcAdress, JSON.stringify(ERC20), ethers.provider)
    await payoutTokenContract.connect(deployer).transfer(user.address, utils.parseUnits('500', await payoutTokenContract.decimals()), {from: deployer.address});
            
    //Approve(payoutToken) to deposit in frontend(user)
    const supply = await payoutTokenContract.totalSupply();//1e+26
    await payoutTokenContract.connect(user).approve(BondContract.address, supply, {from: user.address});
        
    // Transfer(payoutToken) to TreasuryContract for testing
    const transferAmount = utils.parseUnits('200', await payoutTokenContract.decimals());//= 0.002 eth
    await payoutTokenContract.connect(user).transfer(TreasuryContract.address, transferAmount, {from: user.address});

    const depositAmount = utils.parseUnits('200', await payoutTokenContract.decimals());//payoutToken(usdc)
    const maxPrice = 50000;//>= nativePrice(37682)
    console.log("====depositAmount-0::", Number(depositAmount))
    const txd = await BondContract.connect(user).depositWithAsset(
      depositAmount, 
      maxPrice,
      config.usdcAdress,
      config.daiAddress,
      user.address, 
      {from:user.address}
    );
    events = (await txd.wait()).events; 
    const bondCreatedEvent = events[21].args;
    const deposit = Number(BigNumber.from(bondCreatedEvent.deposit))
    const payout = Number(BigNumber.from(bondCreatedEvent.payout))
    const expires = Number(BigNumber.from(bondCreatedEvent.expires))
    
    const lpEvent = events[15].args;
    const lpAddress = lpEvent.lpAddress;
    const lpAmount = Number(BigNumber.from(lpEvent.lpAmount))
    expect(lpAmount).to.equal(deposit);

    const blockNum = await ethers.provider.getBlockNumber()
    const expiresSol = BigNumber.from(blockNum).add(vestingTerm);
    expect(Number(expiresSol)).to.equal(expires);
    
    const bondPriceChangedEvent = events[22].args;
    const internalPrice = Number(BigNumber.from(bondPriceChangedEvent.internalPrice))
    const debtRatio = Number(BigNumber.from(bondPriceChangedEvent.debtRatio))

    const debtRatioSol = await BondContract.connect(deployer).debtRatio({from:deployer.address});
    expect(Number(debtRatioSol)).to.equal(debtRatio)

    // debtRatio=0 so that price = terms.minimumPrice;
    const priceSol = minimumPrice;
    expect(Number(priceSol)).to.equal(internalPrice)
  });

  it('deposit(user) with one Asset, lpTokenAsFeeFlag(false)', async function () {      
    const {
      deployer, user, dao,
      FactoryContract,
      FeesContract
    } = await setup();

    await FeesContract.connect(dao).setTiersAndFees(config.tierCeilings, config.fees, {from: dao.address});

    const tx = await FactoryContract.connect(user).createBondAndTreasury(
      config.usdcAdress, 
      config.daiAddress,
      user.address, 
      {from:user.address}
    )

    const TreasuryFactory = await ethers.getContractFactory('CustomTreasury');
    const BondFactory = await ethers.getContractFactory('CustomBond');
    let events: any = [];
    events = (await tx.wait()).events;    
    const customTreasuryAddr = events[0].args.treasury;
    const customBondAddr = events[0].args.bond;
    const TreasuryContract = TreasuryFactory.attach(customTreasuryAddr);
    const BondContract = BondFactory.attach(customBondAddr);

    // set lpTokenAsFeeFlag as false
    await BondContract.connect(user).setLPtokenAsFee(false, {from: user.address})

    // initialization bond
    const controlVariable = BigNumber.from(82500);
    const vestingTerm = BigNumber.from(46200);
    const minimumPrice = BigNumber.from(36760);
    const maxPayout = BigNumber.from(400);
    const maxDebt = utils.parseEther('1250');
    const initialDebt = utils.parseEther('400')
    await BondContract.connect(user).initializeBond(controlVariable, vestingTerm, minimumPrice, maxPayout, maxDebt, initialDebt, {from:user.address})
     
    const payoutTokenContract = new ethers.Contract(config.usdcAdress, JSON.stringify(ERC20), ethers.provider)
    await payoutTokenContract.connect(deployer).transfer(user.address, utils.parseUnits('500', await payoutTokenContract.decimals()), {from: deployer.address});
            
    //Approve(payoutToken) to deposit in frontend(user)
    const supply = await payoutTokenContract.totalSupply();//1e+26
    await payoutTokenContract.connect(user).approve(BondContract.address, supply, {from: user.address});
    
    // Transfer(payoutToken) to TreasuryContract for testing
    const transferAmount = utils.parseUnits('200', await payoutTokenContract.decimals());//= 0.002 eth
    await payoutTokenContract.connect(user).transfer(TreasuryContract.address, transferAmount, {from: user.address});

    const depositAmount = utils.parseUnits('200', await payoutTokenContract.decimals());//payoutToken(usdc)
    const maxPrice = 50000;//>= nativePrice(37682)
    console.log("====depositAmount-1::", Number(depositAmount))
    const txd = await BondContract.connect(user).depositWithAsset(
      depositAmount, 
      maxPrice,
      config.usdcAdress,
      config.daiAddress,
      user.address, 
      {from:user.address}
    );
    events = (await txd.wait()).events; 
    const bondCreatedEvent = events[21].args;
    const deposit = Number(BigNumber.from(bondCreatedEvent.deposit))
    const payout = Number(BigNumber.from(bondCreatedEvent.payout))
    const expires = Number(BigNumber.from(bondCreatedEvent.expires))
    
    const lpEvent = events[15].args;
    const lpAddress = lpEvent.lpAddress;
    const lpAmount = Number(BigNumber.from(lpEvent.lpAmount))
    expect(lpAmount).to.equal(deposit);

    const blockNum = await ethers.provider.getBlockNumber()
    const expiresSol = BigNumber.from(blockNum).add(vestingTerm);
    expect(Number(expiresSol)).to.equal(expires);
    
    const bondPriceChangedEvent = events[22].args;
    const internalPrice = Number(BigNumber.from(bondPriceChangedEvent.internalPrice))
    const debtRatio = Number(BigNumber.from(bondPriceChangedEvent.debtRatio))

    const debtRatioSol = await BondContract.connect(deployer).debtRatio({from:deployer.address});
    expect(Number(debtRatioSol)).to.equal(debtRatio)

    // debtRatio=0 so that price = terms.minimumPrice;
    const priceSol = minimumPrice;
    expect(Number(priceSol)).to.equal(internalPrice)
  });
});

describe('CustomBond-deposit with one Asset-1', async function () {
  it('one Asset, lpTokenAsFeeFlag(true), depositAsset(uni), payoutAsset(usdc)', async function () {      
    const {
      deployer, user, dao,
      FactoryContract,
      FeesContract
    } = await setup();

    await FeesContract.connect(dao).setTiersAndFees(config.tierCeilings, config.fees, {from: dao.address});

    const tx = await FactoryContract.connect(user).createBondAndTreasury(
      config.usdcAdress, //payoutToken
      config.daiAddress, //principleToken
      user.address,      //initialOwner
      {from:user.address}
    )

    const TreasuryFactory = await ethers.getContractFactory('CustomTreasury');
    const BondFactory = await ethers.getContractFactory('CustomBond');
    let events: any = [];
    events = (await tx.wait()).events;    
    const customTreasuryAddr = events[0].args.treasury;
    const customBondAddr = events[0].args.bond;
    const TreasuryContract = TreasuryFactory.attach(customTreasuryAddr);
    const BondContract = BondFactory.attach(customBondAddr);

    // initialization bond
    const controlVariable = BigNumber.from(82500);
    const vestingTerm = BigNumber.from(46200);
    const minimumPrice = BigNumber.from(36760);
    const maxPayout = BigNumber.from(400);
    const maxDebt = utils.parseEther('1250');
    const initialDebt = utils.parseEther('400')
    await BondContract.connect(user).initializeBond(controlVariable, vestingTerm, minimumPrice, maxPayout, maxDebt, initialDebt, {from:user.address})
     
    // Transfer payoutToken(USDC) from deployer to user
    const payoutTokenContract = new ethers.Contract(config.usdcAdress, JSON.stringify(ERC20), ethers.provider)
    const deployerPayoutBalance = await payoutTokenContract.balanceOf(deployer.address)
    await payoutTokenContract.connect(deployer).transfer(user.address, deployerPayoutBalance, {from: deployer.address});

    //Approve(payoutToken) to deposit in frontend(user)
    await payoutTokenContract.connect(user).approve(BondContract.address, deployerPayoutBalance, {from: user.address});
        
    // Transfer(payoutToken) to TreasuryContract for testing
    const transferAmount = await payoutTokenContract.balanceOf(user.address)
    await payoutTokenContract.connect(user).transfer(TreasuryContract.address, transferAmount, {from: user.address});


    // Transfer uni from deployer to user
    const uniContract = new ethers.Contract(config.uniAddress, JSON.stringify(ERC20), ethers.provider)
    await uniContract.connect(deployer).transfer(user.address, utils.parseUnits('0.2', await uniContract.decimals()), {from: deployer.address});
            
    //Approve(uni) to deposit in frontend(user)
    const uniSupply = await uniContract.totalSupply();
    await uniContract.connect(user).approve(BondContract.address, uniSupply, {from: user.address});

    // deposit Amount
    const maxPrice = BigNumber.from(50000);
    const depositAmount = utils.parseUnits('0.1', await uniContract.decimals());//uni token
    console.log("====depositAmount-2::", Number(depositAmount))
    const txd = await BondContract.connect(user).depositWithAsset(
      depositAmount, 
      maxPrice,
      config.uniAddress,
      config.daiAddress,
      user.address, 
      {from:user.address}
    );
    events = (await txd.wait()).events; 
    const bondCreatedEvent = events[28].args;
    const deposit = Number(BigNumber.from(bondCreatedEvent.deposit))
    const payout = Number(BigNumber.from(bondCreatedEvent.payout))
    const expires = Number(BigNumber.from(bondCreatedEvent.expires))
    
    const lpEvent = events[22].args;
    const lpAddress = lpEvent.lpAddress;
    const lpAmount = Number(BigNumber.from(lpEvent.lpAmount))
    expect(lpAmount).to.equal(deposit);

    const blockNum = await ethers.provider.getBlockNumber()
    const expiresSol = BigNumber.from(blockNum).add(vestingTerm);
    expect(Number(expiresSol)).to.equal(expires);
    
    const bondPriceChangedEvent = events[29].args;
    const internalPrice = Number(BigNumber.from(bondPriceChangedEvent.internalPrice))
    const debtRatio = Number(BigNumber.from(bondPriceChangedEvent.debtRatio))

    const debtRatioSol = await BondContract.connect(deployer).debtRatio({from:deployer.address});
    expect(Number(debtRatioSol)).to.equal(debtRatio)

    // debtRatio=0 so that price = terms.minimumPrice;
    const priceSol = minimumPrice;
    expect(Number(priceSol)).to.equal(internalPrice)
  });

  it('one Asset, lpTokenAsFeeFlag(true), depositAsset(ETH), payoutAsset(usdc)', async function () {      
    const {
      deployer, user, private_key, dao,
      FactoryContract, FeesContract
    } = await setup();

    await FeesContract.connect(dao).setTiersAndFees(config.tierCeilings, config.fees, {from: dao.address});

    const tx = await FactoryContract.connect(user).createBondAndTreasury(
      config.usdcAdress, //payoutToken
      config.daiAddress, //principleToken
      user.address,      //initialOwner
      {from:user.address}
    )

    const TreasuryFactory = await ethers.getContractFactory('CustomTreasury');
    const BondFactory = await ethers.getContractFactory('CustomBond');
    let events: any = [];
    events = (await tx.wait()).events;    
    const customTreasuryAddr = events[0].args.treasury;
    const customBondAddr = events[0].args.bond;
    const TreasuryContract = TreasuryFactory.attach(customTreasuryAddr);
    const BondContract = BondFactory.attach(customBondAddr);

    // initialization bond
    const controlVariable = BigNumber.from(82500);
    const vestingTerm = BigNumber.from(46200);
    const minimumPrice = BigNumber.from(36760);
    const maxPayout = BigNumber.from(400);
    const maxDebt = utils.parseEther('1250');
    const initialDebt = utils.parseEther('400')
    await BondContract.connect(user).initializeBond(controlVariable, vestingTerm, minimumPrice, maxPayout, maxDebt, initialDebt, {from:user.address})
     
    // Transfer payoutToken(USDC) from deployer to user
    const payoutTokenContract = new ethers.Contract(config.usdcAdress, JSON.stringify(ERC20), ethers.provider)
    const deployerPayoutBalance = await payoutTokenContract.balanceOf(deployer.address)
    await payoutTokenContract.connect(deployer).transfer(user.address, deployerPayoutBalance, {from: deployer.address});

    //Approve(payoutToken) to deposit in frontend(user)
    await payoutTokenContract.connect(user).approve(BondContract.address, deployerPayoutBalance, {from: user.address});
    
    // Allow to deposit from user
    // await TreasuryContract.connect(user).toggleBondContract(BondContract.address, {from:user.address})
    
    // Transfer(payoutToken) to TreasuryContract for testing
    const transferAmount = await payoutTokenContract.balanceOf(user.address)
    await payoutTokenContract.connect(user).transfer(TreasuryContract.address, transferAmount, {from: user.address});


    // Transfer ETH from deployer(Metamask) to user
    let privateKey = '0xfef4bb494ac91391c68c226e60497ac5bd713125b5018b4cae8fcc27d78c3054'
    let provider = ethers.getDefaultProvider('rinkeby')
    let wallet = new ethers.Wallet(privateKey, provider)
            
    // deposit Amount
    const depositAmount = utils.parseEther('0.01');//ETH
    let txETH = {
      to: BondContract.address,
      value: depositAmount
    }
    await user.sendTransaction(txETH)
    console.log("====depositAmount-3::", Number(depositAmount))
    const maxPrice = BigNumber.from(50000);
    const txd = await BondContract.connect(user).depositWithAsset(
      depositAmount, 
      maxPrice,
      config.addressZero,
      config.daiAddress,
      user.address, 
      {from:user.address}
    );
    events = (await txd.wait()).events; 
    const bondCreatedEvent = events[24].args;
    const deposit = Number(BigNumber.from(bondCreatedEvent.deposit))
    const payout = Number(BigNumber.from(bondCreatedEvent.payout))
    const expires = Number(BigNumber.from(bondCreatedEvent.expires))
    
    const lpEvent = events[18].args;
    const lpAddress = lpEvent.lpAddress;
    const lpAmount = Number(BigNumber.from(lpEvent.lpAmount))
    expect(lpAmount).to.equal(deposit);

    const blockNum = await ethers.provider.getBlockNumber()
    const expiresSol = BigNumber.from(blockNum).add(vestingTerm);
    expect(Number(expiresSol)).to.equal(expires);
    
    const bondPriceChangedEvent = events[25].args;
    const internalPrice = Number(BigNumber.from(bondPriceChangedEvent.internalPrice))
    const debtRatio = Number(BigNumber.from(bondPriceChangedEvent.debtRatio))

    const debtRatioSol = await BondContract.connect(deployer).debtRatio({from:deployer.address});
    expect(Number(debtRatioSol)).to.equal(debtRatio)

    // debtRatio=0 so that price = terms.minimumPrice;
    const priceSol = minimumPrice;
    expect(Number(priceSol)).to.equal(internalPrice)
  });
});

describe('CustomBond-deposit with one Asset WETH', async function () {
  it('deposit(user) with one Asset - WETH', async function () {      
    const {
      deployer, user, dao,
      FactoryContract,
      FeesContract
    } = await setup();

    await FeesContract.connect(dao).setTiersAndFees(config.tierCeilings, config.fees, {from: dao.address});

    const tx = await FactoryContract.connect(user).createBondAndTreasury(
      config.weth,      //payoutToken
      config.usdcAdress,//principalToken
      user.address,     //initialOwner
      {from:user.address}
    )

    const TreasuryFactory = await ethers.getContractFactory('CustomTreasury');
    const BondFactory = await ethers.getContractFactory('CustomBond');
    let events: any = [];
    events = (await tx.wait()).events;    
    const customTreasuryAddr = events[0].args.treasury;
    const customBondAddr = events[0].args.bond;
    const TreasuryContract = TreasuryFactory.attach(customTreasuryAddr);
    const BondContract = BondFactory.attach(customBondAddr);

    // set bond terms
    // await BondContract.connect(user).setBondTerms(0, 20000, {from: user.address})//_input >= 10000, terms.vestingTerm
    // await BondContract.connect(user).setBondTerms(1, 150, {from: user.address})  //_input <= 1000,  terms.maxPayout
    // await BondContract.connect(user).setBondTerms(2, 2000, {from: user.address}) //                 terms.maxDebt

    // initialization bond
    const controlVariable = BigNumber.from(82500);
    const vestingTerm = BigNumber.from(46200);
    const minimumPrice = BigNumber.from(36760);
    const maxPayout = BigNumber.from(400);
    const maxDebt = utils.parseEther('1250');
    const initialDebt = utils.parseEther('400')
    await BondContract.connect(user).initializeBond(controlVariable, vestingTerm, minimumPrice, maxPayout, maxDebt, initialDebt, {from:user.address})

    const payoutTokenContract = new ethers.Contract(config.weth, JSON.stringify(ERC20), ethers.provider)
    await payoutTokenContract.connect(deployer).transfer(user.address, utils.parseEther('1'), {from: deployer.address});
    
    //Approve(payoutToken) to deposit in frontend(user)
    const supply = await payoutTokenContract.totalSupply();//1e+26
    await payoutTokenContract.connect(user).approve(BondContract.address, supply, {from: user.address});
    
    // Allow/unallow to deposit from user
    // await TreasuryContract.connect(user).toggleBondContract(BondContract.address, {from:user.address})
    
    // Transfer(payoutToken) to TreasuryContract for testing
    const transferAmount = utils.parseEther('0.2');//= 0.2 eth
    await payoutTokenContract.connect(user).transfer(TreasuryContract.address, transferAmount, {from: user.address});

    const depositAmount = utils.parseEther('0.5');//payoutToken(WETH)
    const maxPrice = BigNumber.from(50000);//>= nativePrice(37682)
    console.log("====depositAmount-4::", Number(depositAmount))

    await expect(BondContract.connect(user).depositWithAsset(
      utils.parseEther('0.18'), 
      maxPrice,
      config.weth,
      config.usdcAdress,
      user.address, 
      {from:user.address}
    )).to.be.revertedWith('Slippage limit: more than max price');

    await expect(BondContract.connect(user).depositWithAsset(
      utils.parseEther('0.8'), 
      BigNumber.from(20000000),
      config.weth,
      config.usdcAdress,
      user.address, 
      {from:user.address}
    )).to.be.revertedWith('Bond too small');
    // events = (await txW.wait()).events; 
    // const bondCreatedEvent = events[21].args;
    // const deposit = Number(BigNumber.from(bondCreatedEvent.deposit))
    // const payout = Number(BigNumber.from(bondCreatedEvent.payout))
    // const expires = Number(BigNumber.from(bondCreatedEvent.expires))
    
    // const lpEvent = events[15].args;
    // const lpAddress = lpEvent.lpAddress;
    // const lpAmount = Number(BigNumber.from(lpEvent.lpAmount))
    // expect(lpAmount).to.equal(deposit);

    // const blockNum = await ethers.provider.getBlockNumber()
    // const expiresSol = BigNumber.from(blockNum).add(vestingTerm);
    // expect(Number(expiresSol)).to.equal(expires);
    
    // const bondPriceChangedEvent = events[22].args;
    // const internalPrice = Number(BigNumber.from(bondPriceChangedEvent.internalPrice))
    // const debtRatio = Number(BigNumber.from(bondPriceChangedEvent.debtRatio))

    // const debtRatioSol = await BondContract.connect(deployer).debtRatio({from:deployer.address});
    // expect(Number(debtRatioSol)).to.equal(debtRatio)

    // // debtRatio=0 so that price = terms.minimumPrice;
    // const priceSol = minimumPrice;
    // expect(Number(priceSol)).to.equal(internalPrice)
  });
});

