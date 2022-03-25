import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {config} from '../test/utils';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {
    deployments: { deploy, get },
    ethers: { getSigners },
  } = hre;

  const deployer = (await getSigners())[0]; 
  const dao = (await getSigners())[1]; 

  await deploy('Fees', {
    from: deployer.address,
    args: [
      config.dao,
    ],
    log: true,    
    skipIfAlreadyDeployed: true,
    autoMine: true
  });
};

func.id = 'deploy_fees';
func.tags = ['Fees'];

export default func;