import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {config} from '../test/utils';
import {Factory, FactoryStorage} from '../typechain';
import {ethers} from 'hardhat';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {
    deployments: { deploy, get, log },
    ethers: { getSigners },
  } = hre;

  const deployer = (await getSigners())[0]; 
  const factoryStorage = await get('FactoryStorage');
  const subsidyRouter = await get('SubsidyRouter');
  const helper = await get('Helper');
  const fees = await get('Fees');
  const mockToken = await get('MockToken');

  await deploy('Factory', {
    from: deployer.address,
    args: [
      config.treasury, 
      factoryStorage.address, 
      subsidyRouter.address, 
      helper.address,
      fees.address
    ],
    log: true,    
    skipIfAlreadyDeployed: true,
    autoMine: true, // speed up deployment on local network (ganache, hardhat), no effect on live networks
  });

  const factoryContract = await get("Factory");
  console.log("factory deployed==", factoryContract.address);
  const factoryStorageContract = <FactoryStorage>await ethers.getContract('FactoryStorage');
  await factoryStorageContract.setFactoryAddress(factoryContract.address);
};

func.id = 'deploy_factory'; // id required to prevent reexecution
func.tags = ['Factory'];
func.dependencies = ['FactoryStorage', 'SubsidyRouter', 'Helper', 'Fees', 'MockToken'];

export default func;