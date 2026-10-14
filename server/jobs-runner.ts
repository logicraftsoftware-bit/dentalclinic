import { runJobs } from './jobs.js';
import { db, log } from './core.js';
runJobs().then(result => log.info(result, 'Jobs completed')).catch(error => { log.error({ name: error.name }, 'Jobs failed'); process.exitCode = 1; }).finally(() => db.$disconnect());
