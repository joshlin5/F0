const path = require('path');
const chalk = require('chalk');
const execProvider = require('./exec/ExecProvider');
const sshExec = require('./exec/ssh');
const scpSync= require('./exec/scp');
class BakerxProvider {

    sshConfig(vmName) {
        let localConfigPath = path.join(path.dirname(require.main.filename), "config.txt")
        let getIpCmd = `bakerx ssh-info ${vmName}`;
        return execProvider.exec(getIpCmd, true).then(std => {
            this.exec(`echo '${std}' > ${localConfigPath}`)
            return std
        }).then(sshInfo =>{
            let sshConfig = {
                identifyFile: null,
                port: 2005, 
                user: "vagrant",
                host: "127.0.0.1"
            }
            let fileRegx = /-i "(.*)"/;
            let portRegx = /-p (\d+) /
            sshConfig["identifyFile"] = fileRegx.exec(sshInfo)[1];
            sshConfig["port"] = portRegx.exec(sshInfo)[1];
            return `ssh -q -i "${sshConfig.identifyFile}" -p ${sshConfig.port} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${sshConfig.user}@${sshConfig.host}`;
        });
    }

    run(vmName){
        return execProvider.exec(`bakerx run`);
    }

    delete(vmName){
        let listVM = "vboxmanage list vms";
        return execProvider.exec(listVM, true).then(result =>{
            // check if the name "M2" is used by any VM
            if(result.includes(vmName)){
                console.log(chalk.green(`Name ${vmName} is used, remove the virtual machine...`));
                return execProvider.exec(`bakerx delete vm ${vmName}`);
            }
        })
    }

    ssh(cmd, sshCmd, params=new Map()){
        return sshExec(cmd, sshCmd, params);
    }

    exec(cmd){
        return execProvider.exec(cmd);
    }

    scp(src, dest, inventory){
        return scpSync(src, dest, inventory);
    }
}

module.exports = new BakerxProvider();
