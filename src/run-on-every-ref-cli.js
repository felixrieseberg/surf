import './babel-maybefill';

import _ from 'lodash';
import request from 'request-promise';
import determineChangedRefs from './ref-differ';
import {asyncMap, delay, spawn} from './promise-array';

const d = require('debug')('serf:run-on-every-ref');

const yargs = require('yargs')
  .usage(`Usage: serf-run-build -s http://some.server -r owner/repo -- command arg1 arg2 arg3...
Monitors a GitHub repo and runs a command for each changed branch / PR.`)
  .help('h')
  .alias('s', 'server')
  .describe('s', 'The Serf server to connect to')
  .alias('r', 'repository')
  .describe('r', 'The repository to monitor, in name-with-owner format')
  .alias('j', 'jobs')
  .describe('j', 'The number of concurrent jobs to run. Defaults to 2')
  .alias('h', 'help');

const argv = yargs.argv;

async function main() {
  const cmdWithArgs = argv._;

  if (cmdWithArgs.length < 1) {
    yargs.showHelp();
    process.exit(-1);
  }

  if (!argv.s || !argv.r) {
    yargs.showHelp();
    process.exit(-1);
  }

  let jobs = parseInt(argv.j || '2');
  if (argv.j && (jobs < 1 || jobs > 64)) {
    console.error("--jobs must be an integer");
    yargs.showHelp();
    process.exit(-1);
  }

  // Do an initial fetch to get our initial state
  let refInfo = null;
  let serfUrl = `${argv.s}/info/${argv.r}`;

  const fetchRefs = async () => {
    try {
      refInfo = await request({
        uri: serfUrl,
        json: true
      });
    } catch (e) {
      console.log(`Failed to fetch from ${serfUrl}: ${e.message}`);
      d(e.stack);
      process.exit(-1);
    }
  };

  refInfo = await fetchRefs();

  // All refs on startup are seen refs
  let seenCommits = _.reduce(refInfo, (acc, x) => {
    acc.set(x.object.sha);
    return acc;
  }, new Set());

  while(true) {
    let currentRefs = await fetchRefs();
    let changedRefs = determineChangedRefs(seenCommits, currentRefs);

    await asyncMap(changedRefs, async (ref) => {
      try {
        let output = await spawn(
          cmdWithArgs[0],
          cmdWithArgs.splice(1).concat(ref.object.sha1));

        console.log(output);
      } catch (e) {
        console.error(e);
      }
    }, jobs);

    await delay(30*1000);
  }
}

main()
  .catch((e) => {
    console.error(e.message);
    d(e.stack);
    process.exit(-1);
  });