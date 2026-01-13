import { PrismaClient } from '@prisma/client';
import { Socket } from 'net';

const prisma = new PrismaClient();

// CONFIGURATION
const FREESWITCH_HOST = 'freeswitch'; 
const FREESWITCH_PORT = 8021;        
const FREESWITCH_PASS = 'ClueCon';   

export class Autodialer {
  private isRunning = false;

  async start() {
    console.log('🚀 Autodialer Service Started');
    this.isRunning = true;
    this.loop();
  }

  async stop() {
    this.isRunning = false;
  }

  private async loop() {
    while (this.isRunning) {
      try {
        await this.processCampaigns();
      } catch (err) {
        // Log error but don't crash the loop
        console.error('Dialer Loop Error:', err.message);
      }
      // Wait 2 seconds before checking again
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  private async processCampaigns() {
    const campaigns = await prisma.campaign.findMany({
      where: { status: 'ACTIVE' },
      include: { phoneNumbers: true }
    });

    for (const campaign of campaigns) {
      const leads = await prisma.lead.findMany({
        where: { 
          campaignId: campaign.id, 
          status: 'NEW' 
        },
        take: 5 
      });

      for (const lead of leads) {
        await this.dialLead(lead, campaign);
      }
    }
  }

  private async dialLead(lead: any, campaign: any) {
    console.log(`📞 Dialing ${lead.phoneNumber} for Campaign: ${campaign.name}`);

    const callerId = campaign.phoneNumbers[0]?.number || process.env.OUTBOUND_CALLER_ID || '+17868404940';
    
    // 1. Send the Call Command
    const fsCommand = `bgapi originate {origination_caller_id_number=${callerId},origination_caller_id_name=${callerId},ignore_early_media=true}sofia/gateway/telnyx/${lead.phoneNumber} &transfer(execute-flow XML default)`;
    await this.sendToFreeSwitch(fsCommand);

    // 2. Update Status (Use 'CONTACTED' instead of 'DIALING' to prevent crash)
    try {
        await prisma.lead.update({
          where: { id: lead.id },
          data: { status: 'CONTACTED', lastContactedAt: new Date() }
        });
    } catch (e) {
        console.error("Failed to update lead status (ignoring to keep dialing):", e.message);
    }
  }

  private sendToFreeSwitch(cmd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const client = new Socket();
      client.connect(FREESWITCH_PORT, FREESWITCH_HOST, () => {
        client.write(`auth ${FREESWITCH_PASS}\n\n`);
      });

      client.on('data', (data) => {
        const response = data.toString();
        if (response.includes('Reply-Text: +OK accepted')) {
          client.write(`api ${cmd}\n\n`);
          client.end();
          resolve();
        }
      });

      client.on('error', (err) => {
        console.error('FS Connection Error:', err);
        reject(err);
      });
    });
  }
}
