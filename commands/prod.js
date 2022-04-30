require('dotenv').config()
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const vmProvider = require("../lib/vmProvider");
const bakerxProvider = require("../lib/bakerxProvider");
const VBox = require('../lib/exec/VBoxManage');
exports.command = 'prod up';
exports.desc = 'Create a production on the DigitalOcean';
exports.builder = yargs => {
    yargs.options({
    });
};

const servers=[
	{
		name: 'monitoring',
		ip: '192.168.56.92',
		sync: true,
		image: 'focal'
	},
	{
		name: 'jenkins',
		sync: true,
		image: 'focal',
		// 0: from , 1: to
		portForwarding:[8080,8080]
	},
	{
		name: 'hedgeDoc',
		sync: true,
		image: 'focal',
		portForwarding:[3000,3000]
	}
]


exports.handler = async argv => {
    const { processor } = argv;
	let provider;
	if (processor == "Intel/Amd64") {
        provider = bakerxProvider
    } else {
        provider = vmProvider
    }
	console.log(chalk.greenBright('Provisioning monitoring server...'));

	for (let i in servers) {
		let server = servers[i];
		// clean existed server
		await provider.delete(server.name);
		// create new one
		let cmd = `bakerx run ${server.name} ${server.image} `;
		if(server.ip){
			cmd += `--ip ${server.ip} `
		}
		if(server.sync){
			cmd += `--sync `
		}
		console.log(chalk.greenBright(`Provisioning ${server.name} server...`));
		await provider.exec(cmd);
		if(server.portForwarding && server.portForwarding.length == 2){
			let ports = server.portForwarding;
			VBox.execute('controlvm', `${server.name} natpf1 "service,tcp,,${ports[0]},,${ports[1]}"`).catch( e => e );
		}
		let port = await VBox.getSSHPort(server.name);
		let inventory = `HOST="127.0.0.1"\nPORT="${port}"\nIDENTIFY_FILE="/Users/hungchaoting/.bakerx/insecure_private_key"\nUSER="vagrant"
		`;
		fs.writeFileSync(path.join(__dirname, `../${server.name}-inventory`), inventory);
		console.log(chalk.greenBright(`Server ${server.name} are ready.`));
	}
};
