require('dotenv').config()
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const resemble = require("resemblejs");
const yaml = require('js-yaml');
const vmProvider = require("../lib/vmProvider");
const bakerxProvider = require("../lib/bakerxProvider");

const { async } = require('hasbin');
const { env } = require('process');
exports.command = 'build <job_name> <buildFile_path>';
exports.desc = 'Trigger a build job, running steps outlined by build.yml, wait for output, and print build log.';
exports.builder = yargs => {
    yargs.options({
    });
};


exports.handler = async argv => {
    const { job_name, buildFile_path, processor } = argv;
    
    console.log(chalk.green("triggering a build job"));
    console.log(chalk.green(`Using the yml file: ${buildFile_path}`));
    let doc = yaml.load(fs.readFileSync(buildFile_path, 'utf8'));
    let provider = null;
    let vm_name = 'M3'
    let sshCmd = '';
    if (processor == "Intel/Amd64") {
        provider = bakerxProvider
        sshCmd = await provider.sshConfig(vm_name)
    } else {
        provider = vmProvider
        sshCmd = `ssh ${vm_name}`
    }
    let envParams = new Map();
    envParams.set("{MYSQL_PSSW}", process.env["MYSQL_PSSW"]);
    envParams.set("{GIT_USER}", process.env["GIT_USER"]);
    envParams.set("{TOKEN}", process.env["TOKEN"]);
    envParams.set("{VOLUME}", process.env["VOLUME"]);

    await runSetup(doc.setup)
    console.log( chalk.yellowBright( "\nINSTALLATION COMPLETE! TRIGGERING JOB EXECUTION" ))
    let currentJob = null

    for(let job in doc.jobs){ 
        if (doc.jobs[job].name === job_name){
            currentJob = doc.jobs[job]
        }
    }

    if(!currentJob){
        console.log(chalk.red(`Job ${job_name} doesn't exist in ${buildFile_path}. Stop process...`));
        return;
    }

    let steps = currentJob.steps;
    let cleanup_steps = currentJob.cleanup;

    try {
        await runBuildSteps(steps);

        if ("mutation" in currentJob){
            mutation = currentJob.mutation
            let jsFile = mutation.jsfile
            let fileName = jsFile.split("/").pop();
            let microserviceDir = jsFile.replace(fileName, "");
            let oriFile = `${microserviceDir}${fileName.replace(".js", "-original.js")}`
            await packageInstallation(mutation.url);
            console.log(`Creating copy of original file: ${oriFile}`)
            await provider.ssh(`cp ${jsFile} ${oriFile}`, sshCmd);
            await testharness(mutation, microserviceDir, oriFile, envParams);
        }
    } catch (error) {
        console.log( chalk.yellowBright (`Error ${error}`))
    }
        
    cleanUp(cleanup_steps);
    

    function cleanUp(cleanup_steps) {
        console.log( chalk.yellowBright("\n\nCLEAN UP PROCESS") );
        for (let step in cleanup_steps){
            console.log( chalk.green(cleanup_steps[step].name) );
            provider.ssh(cleanup_steps[step].cmd, sshCmd, envParams);
        }
    }

    async function runSetup(setup_steps) {
        for(let i in setup_steps){
            let task = setup_steps[i];
            console.log(chalk.green(task.name));
            await provider.ssh(task.cmd, sshCmd, envParams)
        }
    }

    async function runBuildSteps(steps) {
        for (let step in steps){
            console.log( chalk.green(steps[step].name) );
            await provider.ssh(steps[step].cmd, sshCmd, envParams)
        }
    }

    async function testharness(mutation, microserviceDir, oriFile, envParams) {
        let targetUrls = mutation.snapshots
        let mutCnt = 0;
        let mutFailCnt = 0;
        await provider.ssh(`cd ${microserviceDir} && pm2 start index.js && cd`, sshCmd);
        await create_compare_screenshot(targetUrls, 'original', envParams)
        for (let i=1; i<=mutation.iterations; i++) {
            await runMutation(oriFile, mutation);
            await provider.ssh(`cd ${microserviceDir} && pm2 kill && pm2 start index.js && cd`, sshCmd);
            await create_compare_screenshot(targetUrls, i, envParams).catch( (error) => {
                mutFailCnt++;
                console.log( chalk.redBright(`\nERROR: ${error}`) );
            });
            mutCnt++;
        }
        console.log( chalk.yellowBright(`THE MUTATION COVERAGE IS: ${mutFailCnt}/${mutCnt}`));
    }

    async function packageInstallation(url) {
        await provider.ssh(`git clone ${url}`, sshCmd);
        dir_name = url.split("/").pop()
        await provider.ssh(`cd ${dir_name} && npm install && cd`, sshCmd);
    }

    async function compare_screenshot(file1, file2) {
        resemble(file1).compareTo(file2).onComplete( function(comparisonData) {
            if (comparisonData.rawMisMatchPercentage > 0) {
                console.log(chalk.redBright(`The mutation file ${file2.split("/").pop()} is ${comparisonData.rawMisMatchPercentage*100}% different compared to the original page.`));
                throw "Image is not matching baseline image"
            }else{
                console.log(chalk.redBright(`The mutation file ${file2.split("/").pop()} is the same as the original page.`));
            }
        });
    }

    async function create_compare_screenshot(targetUrls, picFileNameSuffix, envParams) {
        for(let j in targetUrls){
            let url = targetUrls[j];
            let picFileName = `screenshots/${url.split("/").pop()}-${picFileNameSuffix}`;
            await provider.ssh(`node ASTRewrite/index.js screenshot ${url} {VOLUME}/${picFileName}`, sshCmd, envParams);
            if (picFileNameSuffix != "original") {
                originalPicFileName = picFileName.replace(`-${picFileNameSuffix}`, '-original')
                await compare_screenshot(`${originalPicFileName}.png`, `${picFileName}.png`)
            }
        }
    }
    
    async function runMutation(oriFile, mutation) {
        jsFile = mutation.jsfile
        await provider.ssh(`node ASTRewrite/index.js mutate ${oriFile} ${jsFile}`, sshCmd, envParams)
    }
};
