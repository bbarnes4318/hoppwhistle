import { Socket } from 'net';

import { PrismaClient, Lead, Campaign, PhoneNumber } from '@prisma/client';

const prisma = new PrismaClient();

// CONFIGURATION
const FREESWITCH_HOST = 'freeswitch';
const FREESWITCH_PORT = 8021;
const FREESWITCH_PASS = 'ClueCon';

export class Autodialer {
  private isRunning = false;

  start(): Promise<void> {
    console.log('🚀 Autodialer Service Started');
    this.isRunning = true;
    void this.loop();
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.isRunning = false;
    return Promise.resolve();
  }

  private async loop() {
    while (this.isRunning) {
        try {
          await this.processCampaigns();
        } catch (err) {
          // Log error but don't crash the loop
          console.error('Dialer Loop Error:', err instanceof Error ? err.message : err);
        }
      // Wait 2 seconds before checking again
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  private async processCampaigns() {
    const campaigns = await prisma.campaign.findMany({
      where: { status: 'ACTIVE' },
      include: { phoneNumbers: true },
    });

    for (const campaign of campaigns) {
      const leads = await prisma.lead.findMany({
        where: {
          campaignId: campaign.id,
          status: 'NEW',
        },
        take: 5,
      });

      for (const lead of leads) {
        await this.dialLead(lead, campaign);
      }
    }
  }

  private async dialLead(lead: Lead, campaign: Campaign & { phoneNumbers: PhoneNumber[] }) {
    console.log(`📞 Dialing ${lead.phoneNumber} for Campaign: ${campaign.name}`);

    // DID rotation pool - FracTEL numbers
    const DID_POOL = [
      '+12294222208',
      '+12232331171',
      '+12232331172',
      '+12393999953',
      '+12166678360',
      '+14233398241',
      '+14233434219',
      '+18656000126',
      '+18656000038',
      '+18656000039',
      '+18656000064',
      '+18656000065',
      '+18656000124',
      '+18656000125',
    ];
    const callerId =
      campaign.phoneNumbers[0]?.number || DID_POOL[Math.floor(Math.random() * DID_POOL.length)];

    // 1. Send the Call Command
    const destDigits = lead.phoneNumber.replace(/\D/g, '').slice(-10);
    const fsCommand = `bgapi originate {origination_caller_id_number=${callerId},origination_caller_id_name=${callerId},ignore_early_media=true}sofia/gateway/didcentral/1${destDigits} &transfer(execute-flow XML default)`;
    await this.sendToFreeSwitch(fsCommand);

    // 2. Update Status (Use 'CONTACTED' instead of 'DIALING' to prevent crash)
    try {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { status: 'CONTACTED', lastContactedAt: new Date() },
      });
    } catch (e) {
      console.error('Failed to update lead status (ignoring to keep dialing):', e instanceof Error ? e.message : e);
    }
  }

  private sendToFreeSwitch(cmd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const client = new Socket();
      client.connect(FREESWITCH_PORT, FREESWITCH_HOST, () => {
        client.write(`auth ${FREESWITCH_PASS}\n\n`);
      });

      client.on('data', data => {
        const response = data.toString();
        if (response.includes('Reply-Text: +OK accepted')) {
          client.write(`api ${cmd}\n\n`);
          client.end();
          resolve();
        }
      });

      client.on('error', err => {
        console.error('FS Connection Error:', err);
        reject(err);
      });
    });
  }
}
