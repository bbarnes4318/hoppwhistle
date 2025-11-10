import { randomBytes } from 'crypto';

import { PrismaClient, CallStatus, CallDirection } from '@prisma/client';

const prisma = new PrismaClient();

// Sample data generators
const AREA_CODES = ['212', '310', '415', '646', '713', '312', '404', '305'];
const FIRST_NAMES = ['John', 'Jane', 'Michael', 'Sarah', 'David', 'Emily', 'Robert', 'Jessica'];
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis'];
const COMPANY_NAMES = [
  'Acme Corp', 'Tech Solutions', 'Global Services', 'Digital Marketing',
  'Sales Pro', 'Lead Gen Experts', 'Call Center Plus', 'Telecom Solutions'
];
const CAMPAIGN_NAMES = [
  'Summer Sale 2024', 'Holiday Campaign', 'New Product Launch',
  'Customer Retention', 'Lead Generation', 'Market Research'
];

function randomElement<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randomPhoneNumber(): string {
  const areaCode = randomElement(AREA_CODES);
  const exchange = randomInt(200, 999);
  const number = randomInt(1000, 9999);
  return `+1${areaCode}${exchange}${number}`;
}

function randomDateInRange(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function generateCallSid(): string {
  return `CA${randomBytes(16).toString('hex')}`;
}

function generateTranscriptionText(duration: number): string {
  const wordsPerMinute = 150;
  const wordCount = Math.floor((duration / 60) * wordsPerMinute);
  const words = [
    'hello', 'hi', 'thank', 'you', 'yes', 'no', 'please', 'sure', 'absolutely',
    'interested', 'information', 'product', 'service', 'price', 'cost', 'discount',
    'offer', 'deal', 'special', 'today', 'now', 'available', 'help', 'assist',
    'question', 'answer', 'understand', 'explain', 'details', 'more', 'information'
  ];
  
  let text = '';
  for (let i = 0; i < wordCount; i++) {
    if (i > 0) text += ' ';
    text += randomElement(words);
    if (i % 10 === 9) text += '.';
  }
  return text;
}

async function main() {
  console.log('🎭 Generating demo data...');

  // Find or create demo tenant
  let tenant = await prisma.tenant.findUnique({
    where: { slug: 'demo' },
  });

  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        name: 'Demo Organization',
        slug: 'demo',
        domain: 'demo.hopwhistle.com',
        status: 'ACTIVE',
        metadata: {
          demo: true,
          plan: 'enterprise',
        },
      },
    });
    console.log('✅ Created demo tenant');
  } else {
    console.log('✅ Using existing demo tenant');
  }

  // Clean up existing demo data
  console.log('🧹 Cleaning up existing demo data...');
  await prisma.transcription.deleteMany({ where: { call: { tenantId: tenant.id } } });
  await prisma.recording.deleteMany({ where: { call: { tenantId: tenant.id } } });
  await prisma.cdr.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.callLeg.deleteMany({ where: { call: { tenantId: tenant.id } } });
  await prisma.call.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.invoiceLine.deleteMany({ where: { invoice: { tenantId: tenant.id } } });
  await prisma.invoice.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.buyerEndpoint.deleteMany({ where: { buyer: { tenantId: tenant.id } } });
  await prisma.buyer.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.publisher.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.campaign.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.phoneNumber.deleteMany({ where: { tenantId: tenant.id } });

  // Create phone numbers
  console.log('📞 Creating phone numbers...');
  const phoneNumbers = [];
  for (let i = 0; i < 10; i++) {
    const number = await prisma.phoneNumber.create({
      data: {
        tenantId: tenant.id,
        number: randomPhoneNumber(),
        provider: 'local',
        status: 'ACTIVE',
        capabilities: { voice: true, sms: true },
        purchasedAt: new Date(),
      },
    });
    phoneNumbers.push(number);
  }

  // Create publishers
  console.log('📢 Creating publishers...');
  const publishers = [];
  for (let i = 0; i < 5; i++) {
    const publisher = await prisma.publisher.create({
      data: {
        tenantId: tenant.id,
        name: `${randomElement(COMPANY_NAMES)} Publisher`,
        code: `PUB${String(i + 1).padStart(3, '0')}`,
        status: 'ACTIVE',
        metadata: {
          contactEmail: `publisher${i}@example.com`,
          contactPhone: randomPhoneNumber(),
          source: ['google', 'facebook', 'twitter', 'direct'][i % 4],
          quality: ['high', 'medium', 'low'][i % 3],
        },
      },
    });
    publishers.push(publisher);
  }

  // Create buyers
  console.log('💰 Creating buyers...');
  const buyers = [];
  for (let i = 0; i < 5; i++) {
    const publisher = randomElement(publishers);
    const buyer = await prisma.buyer.create({
      data: {
        tenantId: tenant.id,
        publisherId: publisher.id,
        name: `${randomElement(COMPANY_NAMES)} Buyer`,
        code: `BUYER${String(i + 1).padStart(3, '0')}`,
        status: 'ACTIVE',
        metadata: {
          contactEmail: `buyer${i}@example.com`,
          contactPhone: randomPhoneNumber(),
          maxConcurrentCalls: randomInt(10, 50),
          vertical: ['insurance', 'mortgage', 'solar', 'debt', 'education'][i % 5],
          quality: ['high', 'medium'][i % 2],
        },
      },
    });

    // Create buyer endpoints
    for (let j = 0; j < 2; j++) {
      await prisma.buyerEndpoint.create({
        data: {
          buyerId: buyer.id,
          type: j === 0 ? 'SIP' : 'PSTN',
          destination: j === 0 
            ? `sip:buyer${i}@example.com`
            : randomPhoneNumber(),
          priority: j + 1,
          status: 'ACTIVE',
        },
      });
    }

    buyers.push(buyer);
  }

  // Create campaigns
  console.log('🎯 Creating campaigns...');
  const campaigns = [];
  for (let i = 0; i < 6; i++) {
    const campaign = await prisma.campaign.create({
      data: {
        tenantId: tenant.id,
        name: randomElement(CAMPAIGN_NAMES),
        status: 'ACTIVE',
        publisherId: randomElement(publishers).id,
        metadata: {
          budget: randomInt(1000, 10000),
          target: ['leads', 'sales', 'appointments'][i % 3],
        },
      },
    });
    campaigns.push(campaign);
  }

  // Generate 7 days of calls
  console.log('📞 Generating 7 days of calls...');
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const calls = [];
  const callsPerDay = randomInt(50, 200); // 50-200 calls per day

  for (let day = 0; day < 7; day++) {
    const dayStart = new Date(sevenDaysAgo.getTime() + day * 24 * 60 * 60 * 1000);
    dayStart.setHours(8, 0, 0, 0); // Start at 8 AM
    const dayEnd = new Date(dayStart.getTime() + 12 * 60 * 60 * 1000); // 12 hours

    for (let i = 0; i < callsPerDay; i++) {
      const createdAt = randomDateInRange(dayStart, dayEnd);
      const duration = randomInt(30, 600); // 30 seconds to 10 minutes
      const startedAt = createdAt;
      const answeredAt = new Date(startedAt.getTime() + randomInt(2, 10) * 1000);
      const endedAt = new Date(answeredAt.getTime() + duration * 1000);

      const status = Math.random() > 0.15 ? CallStatus.COMPLETED : 
                     Math.random() > 0.5 ? CallStatus.NO_ANSWER : CallStatus.FAILED;
      const direction = Math.random() > 0.3 ? CallDirection.INBOUND : CallDirection.OUTBOUND;
      const campaign = randomElement(campaigns);
      const fromNumber = randomElement(phoneNumbers);
      const toNumber = randomPhoneNumber();
      const cost = duration * randomFloat(0.01, 0.05); // $0.01-$0.05 per minute

      const call = await prisma.call.create({
        data: {
          tenantId: tenant.id,
          campaignId: campaign.id,
          fromNumberId: fromNumber.id,
          toNumber,
          callSid: generateCallSid(),
          status,
          direction,
          duration: status === CallStatus.COMPLETED ? duration : null,
          cost: status === CallStatus.COMPLETED ? cost : null,
          createdAt,
          startedAt,
          answeredAt: status === CallStatus.COMPLETED ? answeredAt : null,
          endedAt,
          metadata: {
            publisher: publishers.find(p => p.id === campaign.publisherId)?.name,
            buyer: randomElement(buyers).name,
            source: ['web', 'phone', 'mobile', 'referral'][Math.floor(Math.random() * 4)],
          },
        },
      });

      // Create CDR
      if (status === CallStatus.COMPLETED) {
        await prisma.cdr.create({
          data: {
            callId: call.id,
            tenantId: tenant.id,
            fromNumber: fromNumber.number,
            toNumber,
            duration,
            billableDuration: duration,
            cost,
            rate: cost / duration,
            direction,
            status,
          },
        });
      }

      // Create recording (70% of completed calls)
      if (status === CallStatus.COMPLETED && Math.random() > 0.3) {
        await prisma.recording.create({
          data: {
            callId: call.id,
            tenantId: tenant.id,
            url: `https://recordings.hopwhistle.com/${call.callSid}.wav`,
            format: 'wav',
            duration,
            size: duration * 16000, // Approximate size
            status: 'COMPLETED',
            metadata: {
              storage: 's3',
              bucket: 'recordings',
            },
          },
        });
      }

      // Create transcription (50% of completed calls with recordings)
      if (status === CallStatus.COMPLETED && Math.random() > 0.5) {
        const recording = await prisma.recording.findFirst({
          where: { callId: call.id },
        });
        
        if (recording) {
          const transcriptionText = generateTranscriptionText(duration);
          await prisma.transcription.create({
            data: {
              callId: call.id,
              recordingId: recording.id,
              text: transcriptionText,
              language: 'en-US',
              confidence: randomFloat(0.85, 0.99),
              metadata: {
                provider: 'deepgram',
                model: 'nova-2',
                words: transcriptionText.split(' ').length,
              },
            },
          });
        }
      }

      calls.push(call);
    }
  }

  console.log(`✅ Created ${calls.length} calls`);

  // Create billing account
  const billingAccount = await prisma.billingAccount.create({
    data: {
      tenantId: tenant.id,
      name: 'Demo Billing Account',
      status: 'ACTIVE',
      currency: 'USD',
    },
  });

  // Generate invoices for the last 30 days
  console.log('🧾 Generating invoices...');
  const invoiceStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  
  for (let i = 0; i < 4; i++) {
    const invoiceDate = new Date(invoiceStart.getTime() + i * 7 * 24 * 60 * 60 * 1000);
    const dueDate = new Date(invoiceDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    
    // Calculate totals from calls in this period
    const periodStart = new Date(invoiceDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    const periodEnd = invoiceDate;
    
    const periodCalls = calls.filter(c => 
      c.createdAt >= periodStart && c.createdAt < periodEnd && c.cost
    );
    const subtotal = periodCalls.reduce((sum, c) => sum + Number(c.cost || 0), 0);
    const tax = subtotal * 0.08; // 8% tax
    const total = subtotal + tax;

    const invoice = await prisma.invoice.create({
      data: {
        billingAccountId: billingAccount.id,
        invoiceNumber: `INV-2024-${String(i + 1).padStart(4, '0')}`,
        status: i < 2 ? 'PAID' : i === 2 ? 'SENT' : 'DRAFT',
        periodStart,
        periodEnd: invoiceDate,
        dueDate,
        subtotal,
        tax,
        total,
        paidAt: i < 2 ? invoiceDate : null,
        metadata: {
          callCount: periodCalls.length,
        },
      },
    });

    // Create invoice lines
    const lineItems = [
      { description: 'Call Minutes', quantity: Math.floor(subtotal / 0.03), unitPrice: 0.03 },
      { description: 'Phone Numbers', quantity: phoneNumbers.length, unitPrice: 2.00 },
      { description: 'Transcriptions', quantity: Math.floor(periodCalls.length * 0.5), unitPrice: 0.10 },
    ];

    for (const item of lineItems) {
      await prisma.invoiceLine.create({
        data: {
          invoiceId: invoice.id,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.quantity * item.unitPrice,
        },
      });
    }
  }

  console.log('✅ Created 4 invoices');

  // Summary
  const callStats = {
    total: calls.length,
    completed: calls.filter(c => c.status === CallStatus.COMPLETED).length,
    failed: calls.filter(c => c.status === CallStatus.FAILED).length,
    inbound: calls.filter(c => c.direction === CallDirection.INBOUND).length,
    outbound: calls.filter(c => c.direction === CallDirection.OUTBOUND).length,
  };

  console.log('\n📊 Demo Data Summary:');
  console.log(`  Phone Numbers: ${phoneNumbers.length}`);
  console.log(`  Publishers: ${publishers.length}`);
  console.log(`  Buyers: ${buyers.length}`);
  console.log(`  Campaigns: ${campaigns.length}`);
  console.log(`  Calls: ${callStats.total}`);
  console.log(`    - Completed: ${callStats.completed}`);
  console.log(`    - Failed: ${callStats.failed}`);
  console.log(`    - Inbound: ${callStats.inbound}`);
  console.log(`    - Outbound: ${callStats.outbound}`);
  console.log(`  Invoices: 4`);
  console.log('\n✅ Demo data generation complete!');
}

main()
  .catch((e) => {
    console.error('❌ Error generating demo data:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

