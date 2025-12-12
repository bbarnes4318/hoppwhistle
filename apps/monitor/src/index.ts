import dotenv from 'dotenv-flow';
import esl from 'modesl';

dotenv.config();

const FREESWITCH_HOST: string = process.env.FREESWITCH_ESL_HOST || 'freeswitch';
const FREESWITCH_PORT: number = parseInt(process.env.FREESWITCH_ESL_PORT || '8021');
const FREESWITCH_PASSWORD: string = process.env.FREESWITCH_ESL_PASSWORD || 'ClueCon';

const CHECK_INTERVAL_MS: number = 30000; // Check every 30 seconds

function checkFreeSwitchHealth(): void {
  console.log(`[Monitor] Checking FreeSWITCH health at ${FREESWITCH_HOST}:${FREESWITCH_PORT}...`);

  const conn = new esl.Connection(FREESWITCH_HOST, FREESWITCH_PORT, FREESWITCH_PASSWORD, () => {
    console.log('[Monitor] ✅ FreeSWITCH ESL Connection Successful');

    // The 'res' object from esl.api is typically an Esl.Event object
    conn.api('status', (res: esl.Event) => {
      console.log('[Monitor] FreeSWITCH Status:', res.getBody());
      conn.disconnect();
    });
  });

  conn.on('error', (err: Error) => {
    console.error('[Monitor] ❌ FreeSWITCH ESL Connection Failed:', err.message);
    // TODO: Send alert to Slack/Email
  });
}

function startMonitor() {
  console.log('[Monitor] Starting Health Monitor Service...');
  checkFreeSwitchHealth();
  setInterval(checkFreeSwitchHealth, CHECK_INTERVAL_MS);
}

startMonitor();
