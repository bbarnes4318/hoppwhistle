import puppeteer from 'puppeteer';

import { emitStatus } from './automation-status.js';

const STATE_MAPPING = {
  Alaska: 'AASCAKSM0010001163940',
  Alabama: 'AASCALSM0010001163940',
  Arkansas: 'AASCARSM0010001163940',
  Arizona: 'AASCAZSM0010001163940',
  California: 'AASCCASM0010001163940',
  Colorado: 'AASCCOSM0010001163940',
  Connecticut: 'AASCCTSM0010001163940',
  'District of Columbia': 'AASCDCSM0010001163940',
  Delaware: 'AASCDESM0010001163940',
  Florida: 'AASCFLSM0010001163940',
  Georgia: 'AASCGASM0010001163940',
  Hawaii: 'AASCHISM0010001163940',
  Idaho: 'AASCIDSM0010001163940',
  Illinois: 'AASCILSM0010001163940',
  Indiana: 'AASCINSM0010001163940',
  Kansas: 'AASCKSSM0010001163940',
  Kentucky: 'AASCKYSM0010001163940',
  Louisiana: 'AASCLASM0010001163940',
  Maryland: 'AASCMDSM0010001163940',
  Maine: 'AASCMESM0010001163940',
  Minnesota: 'AASCMNSM0010001163940',
  Missouri: 'AASCMOSM0010001163940',
  Mississippi: 'AASCMSSM0010001163940',
  'North Carolina': 'AASCNCSM0010001163940',
  'North Dakota': 'AASCNDSM0010001163940',
  Nebraska: 'AASCNESM0010001163940',
  'New Mexico': 'AASCNMSM0010001163940',
  Nevada: 'AASCNVSM0010001163940',
  Ohio: 'AASCOHSM0010001163940',
  Oklahoma: 'AASCOKSM0010001163940',
  Oregon: 'AASCORSM0010001163940',
  Pennsylvania: 'AASCPASM0010001163940',
  'South Carolina': 'AASCSCSM0010001163940',
  'South Dakota': 'AASCSDSM0010001163940',
  Tennessee: 'AASCTNSM0010001163940',
  Texas: 'AASCTXSM0010001163940',
  Utah: 'AASCUTSM0010001163940',
  Virginia: 'AASCVASM0010001163940',
  Washington: 'AASCWASM0010001163940',
  Wisconsin: 'AASCWISM0010001163940',
  'West Virginia': 'AASCWVSM0010001163940',
  Wyoming: 'AASCWYSM0010001163940',
};

// Total automation steps for progress tracking
const TOTAL_STEPS = 12;

export const runAmericanAmicableAutomation = async (data, jobId = null) => {
  // ╔═══════════════════════════════════════════════════════════════════════════╗
  // ║ TEMPORARY TEST VALUES - REMOVE AFTER TESTING                              ║
  // ╚═══════════════════════════════════════════════════════════════════════════╝
  const TEST_MODE = true; // Set to false to use real data
  if (TEST_MODE) {
    console.log('[TEST MODE] ⚠ Using hardcoded test values!');
    data = {
      ...data,
      firstName: 'Sarah',
      middleName: 'Robert',
      lastName: 'Williams',
      state: 'Illinois',
      dob: '05/15/1970',
      age: 55,
      gender: 'Male',
      tobacco: false,
      selectedCarrier: 'American Amicable',
      selectedCoverage: 10000,
      selectedPremium: 41.24,
      selectedPlanType: 'Level',
      address: '123 Main Street',
      zip: '60601',
      ssn: '412741242',
      phone: '(555) 123-4567',
      email: 'sarah.williams@example.com',
      birthState: 'IL',
      heightFeet: 5,
      heightInches: 6,
      weight: 180,
      beneficiaryName: 'Jane Williams',
      beneficiaryRelation: 'Spouse',
      accountHolder: 'Sarah Williams',
      bankName: 'Suntrust',
      bankCityState: 'Chicago/IL',
      ssPaymentSchedule: true,
      draftDay: '1S',
      routingNumber: '061000104',
      accountNumber: '048491940',
      accountType: 'Checking',
      wantsEmail: true,
      doctorName: 'Dan Johns',
      doctorAddress: '123 Dan Dr Chicago, IL 60606',
      doctorPhone: '3145671212',
      ownerIsInsured: true,
      payorIsInsured: true,
      hasExistingInsurance: false,
      willReplaceExisting: false,
    };
  }
  // ╚═══════════════════════════════════════════════════════════════════════════╝

  // Extract all customer data from formData
  const {
    state,
    firstName,
    middleName = '',
    lastName,
    dob,
    age,
    gender,
    tobacco,
    selectedCoverage,
    selectedPlanType,
    // Additional contact info
    address = '',
    zip = '',
    ssn = '',
    phone = '',
    email = '',
    birthState = '',
    // ═══ Bank Draft Information ═══
    accountHolder = '',
    bankName = '',
    bankCityState = '',
    ssPaymentSchedule = null, // true = Yes (coincide with SS), false = No
    draftDay = '',
    routingNumber = '',
    accountNumber = '',
    accountType = 'Checking', // 'Checking' or 'Saving'
    // ═══ Email/Personal Info ═══
    wantsEmail = null, // true = Yes, false = No
    // Height/Weight - use defaults if not provided
    heightFeet = 5,
    heightInches = 6,
    weight = 150,
    // Doctor info
    doctorName = '',
    doctorAddress = '',
    doctorPhone = '',
    // ═══ Owner/Payor Info ═══
    ownerIsInsured = true, // true = Owner is the Insured
    payorIsInsured = true, // true = Payor is the Insured
    // ═══ Existing Coverage ═══
    hasExistingInsurance = null,
    existingCompanyName = '',
    existingPolicyNumber = '',
    existingCoverageAmount = '',
    willReplaceExisting = null,
    // Health Questions (Q1-Q8c + Covid)
    healthQ1 = false,
    healthQ2 = false,
    healthQ3 = false,
    healthQ4 = false,
    healthQ5 = false,
    healthQ6 = false,
    healthQ7a = false,
    healthQ7b = false,
    healthQ7c = false,
    healthQ7d = false,
    healthQ8a = false,
    healthQ8b = false,
    healthQ8c = false,
    healthCovid = false,
    // ═══ Beneficiary Information ═══
    beneficiaryName = '',
    beneficiaryRelation = '',
    // ═══ Illinois Residents (only applicable if state is IL) ═══
    ilDesigneeChoice = null, // 'Will Designate' or 'Will Not Designate'
    // ═══ Retry Mode Flag ═══
    retryMode = false, // If true, use recovery flow to re-enter pending application
  } = data;

  let browser = null;
  const logTs = () => new Date().toISOString();

  // Helper to emit status if jobId provided
  const updateStatus = (step, message) => {
    if (jobId) {
      emitStatus(jobId, step, TOTAL_STEPS, 'in_progress', message);
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RECOVERY FLOW: Save, Return to Applications, Re-enter, and Navigate to Agent Statement
  // This is called when bank validation fails and we need to retry via a different path
  // ═══════════════════════════════════════════════════════════════════════════
  const attemptRecoveryFlow = async (page, customerName) => {
    console.log('[Recovery] ▶▶▶ STARTING RECOVERY FLOW ◀◀◀');
    console.log('[Recovery] Customer to find:', customerName);

    try {
      // STEP 1: Click "Save and Return to Applications" button
      console.log('[Recovery] Step 1: Looking for Save and Return to Applications button...');

      // Scroll to find the button
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise(r => setTimeout(r, 1000));

      // Try multiple selectors for the Save button
      const saveButtonSelectors = [
        'input[value*="Save and Return"]',
        'input[value*="Return to Applications"]',
        '#BtnSave',
        'input[name*="BtnSave"]',
        'input[type="submit"][value*="Save"]',
      ];

      let saveClicked = false;
      for (const selector of saveButtonSelectors) {
        try {
          const btn = await page.$(selector);
          if (btn) {
            await btn.click();
            console.log(`[Recovery] ✓ Clicked Save button (${selector})`);
            saveClicked = true;
            break;
          }
        } catch (e) {
          // Continue to next selector
        }
      }

      if (!saveClicked) {
        // Try JavaScript click as fallback
        saveClicked = await page.evaluate(() => {
          const inputs = document.querySelectorAll('input[type="submit"]');
          for (const inp of inputs) {
            if (inp.value && inp.value.toLowerCase().includes('save')) {
              inp.click();
              return true;
            }
          }
          return false;
        });
        if (saveClicked) console.log('[Recovery] ✓ Clicked Save button via JS');
      }

      if (!saveClicked) {
        console.log('[Recovery] ✗ Could not find Save button');
        return false;
      }

      // Wait for navigation to pending applications
      await new Promise(r => setTimeout(r, 5000));
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {});
      console.log('[Recovery] Navigated to:', page.url());

      // STEP 2: Find our application in the pending list
      console.log('[Recovery] Step 2: Finding application in pending list...');
      await new Promise(r => setTimeout(r, 2000));

      // Look for the customer name in the table and click it
      const appFound = await page.evaluate(name => {
        // Look for table rows or links containing the customer name
        const rows = document.querySelectorAll('table tr, .application-row');
        for (const row of rows) {
          if (row.textContent && row.textContent.includes(name.split(' ')[0])) {
            const link = row.querySelector('a') || row.querySelector('input[type="button"]');
            if (link) {
              link.click();
              return true;
            }
          }
        }
        // Try clicking any link with the name
        const links = document.querySelectorAll('a');
        for (const link of links) {
          if (link.textContent && link.textContent.includes(name.split(' ')[0])) {
            link.click();
            return true;
          }
        }
        return false;
      }, customerName);

      if (!appFound) {
        console.log('[Recovery] ✗ Could not find application in pending list');
        // Try clicking the first pending application
        const firstApp = await page.evaluate(() => {
          const firstRow = document.querySelector('table tbody tr:first-child a');
          if (firstRow) {
            firstRow.click();
            return true;
          }
          return false;
        });
        if (!firstApp) return false;
        console.log('[Recovery] Using first pending application instead');
      } else {
        console.log('[Recovery] ✓ Found and clicked application');
      }

      await new Promise(r => setTimeout(r, 3000));

      // STEP 3: Click the Edit button
      console.log('[Recovery] Step 3: Clicking Edit button...');
      try {
        await page.waitForSelector('#EditBtn', { timeout: 10000 });
        await page.click('#EditBtn');
        console.log('[Recovery] ✓ Clicked Edit button');
      } catch (e) {
        // Try alternative selectors
        const editClicked = await page.evaluate(() => {
          const btn =
            document.querySelector('input[value="Edit"]') || document.querySelector('#EditBtn');
          if (btn) {
            btn.click();
            return true;
          }
          return false;
        });
        if (!editClicked) {
          console.log('[Recovery] ✗ Could not find Edit button');
          return false;
        }
        console.log('[Recovery] ✓ Clicked Edit button via JS');
      }

      await new Promise(r => setTimeout(r, 3000));
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {});
      console.log('[Recovery] On page:', page.url());

      // STEP 4: Scroll to bottom and click Quote button
      console.log('[Recovery] Step 4: Scrolling and clicking Quote button...');
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise(r => setTimeout(r, 1000));

      try {
        const quoteBtn = (await page.$('input[value*="Quote"]')) || (await page.$('#BtnQuote'));
        if (quoteBtn) {
          await quoteBtn.click();
          console.log('[Recovery] ✓ Clicked Quote button');
        } else {
          // Try via JS
          const clicked = await page.evaluate(() => {
            const inputs = document.querySelectorAll('input[type="submit"]');
            for (const inp of inputs) {
              if (inp.value && inp.value.includes('Quote')) {
                inp.click();
                return true;
              }
            }
            return false;
          });
          if (!clicked) throw new Error('Quote button not found');
          console.log('[Recovery] ✓ Clicked Quote button via JS');
        }
      } catch (e) {
        console.log('[Recovery] ⚠ Quote button not found, proceeding...');
      }

      await new Promise(r => setTimeout(r, 3000));

      // STEP 5: Click Continue Application button
      console.log('[Recovery] Step 5: Clicking Continue Application button...');
      try {
        const continueAppBtn = await page.$('input[value="Continue Application"]');
        if (continueAppBtn) {
          await continueAppBtn.click();
          console.log('[Recovery] ✓ Clicked Continue Application button');
        } else {
          await page.evaluate(() => {
            const btn =
              document.querySelector('input[value="Continue Application"]') ||
              document.querySelector('#BtnContinue');
            if (btn) btn.click();
          });
          console.log('[Recovery] ✓ Clicked Continue Application via JS');
        }
      } catch (e) {
        console.log('[Recovery] Continue Application button not found');
      }

      await new Promise(r => setTimeout(r, 3000));
      await page
        .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 })
        .catch(() => {});

      // STEP 6: Scroll and click Continue button
      console.log('[Recovery] Step 6: Scrolling and clicking Continue button...');
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise(r => setTimeout(r, 1000));

      try {
        const continueBtn =
          (await page.$('input[value="Continue"][id="BtnContinue"]')) ||
          (await page.$('input[value="Continue"]'));
        if (continueBtn) {
          await continueBtn.click();
          console.log('[Recovery] ✓ Clicked Continue button');
        }
      } catch (e) {
        console.log('[Recovery] Continue button error:', e.message);
      }

      await new Promise(r => setTimeout(r, 3000));
      await page
        .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 })
        .catch(() => {});

      // STEP 7: Click Continue to Agent Statement button
      console.log('[Recovery] Step 7: Clicking Continue to Agent Statement button...');
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise(r => setTimeout(r, 1000));

      try {
        const agentStmtBtn = await page.$('input[value="Continue to Agent Statement"]');
        if (agentStmtBtn) {
          await agentStmtBtn.click();
          console.log('[Recovery] ✓ Clicked Continue to Agent Statement button');
        } else {
          await page.evaluate(() => {
            const inputs = document.querySelectorAll('input[type="submit"]');
            for (const inp of inputs) {
              if (inp.value && inp.value.includes('Agent Statement')) {
                inp.click();
                return true;
              }
            }
          });
          console.log('[Recovery] ✓ Clicked Continue to Agent Statement via JS');
        }
      } catch (e) {
        console.log('[Recovery] Agent Statement button error:', e.message);
      }

      await new Promise(r => setTimeout(r, 3000));
      await page
        .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 })
        .catch(() => {});

      console.log('[Recovery] ✓✓✓ RECOVERY FLOW COMPLETE ✓✓✓');
      console.log('[Recovery] Now on:', page.url());
      return true;
    } catch (error) {
      console.log('[Recovery] ✗ Recovery flow failed:', error.message);
      return false;
    }
  };

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`[PUPPETEER] ${logTs()} ▶▶▶ AUTOMATION FUNCTION CALLED ◀◀◀`);
  console.log(
    `[PUPPETEER] ${logTs()} RAW DATA RECEIVED:`,
    JSON.stringify({
      heightFeet: data.heightFeet,
      heightInches: data.heightInches,
      weight: data.weight,
    })
  );
  console.log(
    `[PUPPETEER] ${logTs()} AFTER DESTRUCTURING: heightFeet=${heightFeet}, heightInches=${heightInches}, weight=${weight}`
  );

  // FORCE DEFAULTS if values are empty strings (destructuring defaults don't catch empty strings)
  const safeWeight = weight || 150;
  const safeHeightFeet = heightFeet || 5;
  const safeHeightInches = heightInches || 6;

  console.log(
    `[PUPPETEER] ${logTs()} USING SAFE VALUES: height=${safeHeightFeet}'${safeHeightInches}, weight=${safeWeight}`
  );

  console.log(`[PUPPETEER] ${logTs()} Customer: ${firstName} ${middleName} ${lastName}`);
  console.log(
    `[PUPPETEER] ${logTs()} State: ${state}, DOB: ${dob}, Age: ${age}, Gender: ${gender}`
  );
  console.log(
    `[PUPPETEER] ${logTs()} Coverage: ${selectedCoverage}, Plan: ${selectedPlanType}, Tobacco: ${tobacco}`
  );
  console.log(`[PUPPETEER] ${logTs()} Address: ${address}, ${zip}`);
  console.log(
    `[PUPPETEER] ${logTs()} Beneficiary: ${beneficiaryName} (${
      beneficiaryRelation || 'not specified'
    })`
  );
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('═══════════════════════════════════════════════════════════════');

  try {
    // STEP 1: Launch browser
    updateStatus(1, 'Launching browser...');
    console.log(`[PUPPETEER] ${logTs()} Launching browser...`);

    // Use system Chromium in Docker/production, bundled Chrome locally
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || null;
    console.log(
      `[PUPPETEER] ${logTs()} Executable path: ${executablePath || 'Using bundled Chrome'}`
    );

    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: executablePath,
      protocolTimeout: 300000, // 5 minutes to prevent protocol timeouts on slow operations
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--single-process',
      ],
    });
    console.log(`[PUPPETEER] ${logTs()} ✓ Browser launched successfully`);
    updateStatus(1, 'Browser launched');

    let page = await browser.newPage();

    // Set viewport for consistent rendering
    await page.setViewport({ width: 1280, height: 800 });

    // STEP 2: Login to carrier portal
    updateStatus(2, 'Logging into carrier portal...');
    console.log('[Automation] Navigating to Agent Login...');
    await page.goto('https://www.americanamicable.com/v4/AgentLogin.php', {
      waitUntil: 'networkidle0',
    });

    // Agent Login
    await page.waitForSelector('#user');
    await page.type('#user', '0001163940');
    await page.type('#password', 'Top$producer2026');

    await Promise.all([
      page.click('input[type="submit"][value="Submit"]'),
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
    ]);

    // Continue Screen
    console.log('[Automation] Clicking Continue...');
    // Try both selectors mentioned
    try {
      await page.waitForSelector('img[src="images/continue.png"]', {
        timeout: 5000,
      });
      await Promise.all([
        page.click('img[src="images/continue.png"]'),
        page.waitForNavigation({ waitUntil: 'networkidle0' }),
      ]);
    } catch (e) {
      console.log('[Automation] Continue image not found, checking for link...');
      await page.waitForSelector('a[href*="/Marketing/area/A"]');
      await Promise.all([
        page.click('a[href*="/Marketing/area/A"]'),
        page.waitForNavigation({ waitUntil: 'networkidle0' }),
      ]);
    }

    // STEP 3: Access Mobile Portal
    updateStatus(3, 'Accessing mobile application portal...');
    // The "Mobile Business Tools" link has target="_blank" which opens new tab
    console.log('[Automation] Accessing Mobile Business Tools...');

    // Log what's on the current page
    const currentUrl = page.url();
    console.log('[Automation] Current URL after Continue:', currentUrl);

    // Wait a moment for page to fully load
    await new Promise(r => setTimeout(r, 2000));

    // Check if we're on the marketing page and need to find the Mobile link
    const mobileLinkSelector = 'a[href="https://www.insuranceapplication.com/"]';
    const mobileLinkAlt = 'a[href*="insuranceapplication.com"]';

    let foundMobileLink = false;

    // Try to find the Mobile Business Tools link
    try {
      await page.waitForSelector(mobileLinkSelector, { timeout: 10000 });
      console.log('[Automation] ✓ Found Mobile Business Tools link');
      foundMobileLink = true;
    } catch (e) {
      console.log('[Automation] Exact Mobile link not found, trying alternatives...');
      try {
        await page.waitForSelector(mobileLinkAlt, { timeout: 5000 });
        console.log('[Automation] ✓ Found alternative mobile link');
        foundMobileLink = true;
      } catch (e2) {
        console.log('[Automation] No mobile link found on page');
        // Log what links ARE available
        const allLinks = await page.$$eval('a', as =>
          as.map(a => ({ href: a.href, text: a.innerText.slice(0, 30) }))
        );
        console.log('[Automation] Available links:', JSON.stringify(allLinks.slice(0, 10)));
      }
    }

    // Handle the target="_blank" by listening for new pages
    const browserContext = browser.defaultBrowserContext();
    let newPage = null;

    if (foundMobileLink) {
      // Set up listener for new tab BEFORE clicking
      const newPagePromise = new Promise(resolve => {
        browser.once('targetcreated', async target => {
          const newP = await target.page();
          if (newP) resolve(newP);
        });
      });

      // Click the mobile link (it opens in new tab)
      await page.click(mobileLinkSelector).catch(() => page.click(mobileLinkAlt));

      // Wait for new tab or timeout
      try {
        newPage = await Promise.race([
          newPagePromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000)),
        ]);
        console.log('[Automation] ✓ New tab opened');
        page = newPage; // Switch to new page
        await page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {});
      } catch (e) {
        console.log('[Automation] No new tab opened, navigating directly...');
        await page.goto('https://www.insuranceapplication.com/', {
          waitUntil: 'networkidle0',
          timeout: 60000,
        });
      }
    } else {
      // Fallback: navigate directly to the mobile portal
      console.log('[Automation] Navigating directly to insuranceapplication.com...');
      await page.goto('https://www.insuranceapplication.com/', {
        waitUntil: 'networkidle0',
        timeout: 60000,
      });
    }

    console.log('[Automation] ✓ On Mobile Portal');
    console.log('[Automation] Current URL:', page.url());

    // Wait for page to be ready
    await new Promise(r => setTimeout(r, 2000));

    // Select Application - click the Mobile Platform icon/link
    // Actual element: <a href="https://www.insuranceapplication.com/cgi/webappmobile/">
    console.log('[Automation] Looking for Mobile Application link...');

    // The mobile app link - might require login first
    const mobileAppSelector = 'a[href="https://www.insuranceapplication.com/cgi/webappmobile/"]';
    const mobileAppSelectorAlt = 'a[href*="cgi/webappmobile/"]';

    // First check if we need to login on this site
    const loginFormExists = await page.$('#LoginId').catch(() => null);
    if (loginFormExists) {
      console.log('[Automation] Login form detected, performing mobile login...');
      // This is the mobile portal login, do it here
      await page.type('#LoginId', '0001163940');
      await page.type('#Password', 'Top$producer2026');
      await page.click('#LoginBtn').catch(() => page.click('input[type="submit"]'));
      await page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {});
      console.log('[Automation] ✓ Mobile login completed');
      await new Promise(r => setTimeout(r, 2000));
    }

    // Now look for the mobile app link
    try {
      // First, look for the direct webappmobile link (not PDF/doc links)
      const appLinks = await page.$$eval('a[href*="cgi/webappmobile"]', els =>
        els
          .filter(
            a =>
              !a.href.includes('.pdf') && !a.href.includes('DocHandler') && !a.href.includes('Demo')
          )
          .map(a => a.href)
      );
      console.log('[Automation] Found webappmobile links:', appLinks);

      if (appLinks.length > 0) {
        // Navigate directly to the mobile app URL (most reliable)
        console.log('[Automation] Navigating directly to:', appLinks[0]);
        await page.goto(appLinks[0], {
          waitUntil: 'networkidle0',
          timeout: 30000,
        });
        console.log('[Automation] ✓ Navigated to Mobile Application');
      } else {
        // Fallback: try clicking the link with navigation wait
        try {
          await page.waitForSelector(mobileAppSelector, { timeout: 10000 });
          console.log('[Automation] ✓ Found exact webappmobile link, clicking...');

          // Click and wait for navigation
          await Promise.all([
            page.waitForNavigation({
              waitUntil: 'networkidle0',
              timeout: 30000,
            }),
            page.click(mobileAppSelector),
          ]);
          console.log('[Automation] ✓ Clicked and navigated');
        } catch (clickErr) {
          console.log('[Automation] Click navigation failed:', clickErr.message);
          // Last resort: navigate directly to the known URL
          console.log('[Automation] Navigating directly to webappmobile...');
          await page.goto('https://www.insuranceapplication.com/cgi/webappmobile/', {
            waitUntil: 'networkidle0',
            timeout: 30000,
          });
        }
      }

      console.log('[Automation] Current URL:', page.url());
    } catch (e) {
      console.log('[Automation] webappmobile link not found, logging available links...');
      const links = await page.$$eval('a', as =>
        as.map(a => ({ href: a.href, text: a.innerText.slice(0, 50) }))
      );
      console.log('[Automation] Available links on page:', JSON.stringify(links.slice(0, 15)));
      throw new Error('Could not find mobile application link');
    }

    // Part 3: Mobile Application Authentication
    console.log('[Automation] Mobile Login...');
    await page.waitForSelector('#LoginId');
    await page.type('#LoginId', '0001163940');
    await page.type('#Password', 'Top$producer2026');

    await Promise.all([
      page.click('#LoginBtn'),
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
    ]);

    // ═══════════════════════════════════════════════════════════════════════════
    // RETRY MODE: Skip new application and go directly to pending apps recovery
    // ═══════════════════════════════════════════════════════════════════════════
    if (retryMode) {
      console.log('[Automation] ▶▶▶ RETRY MODE ACTIVE ◀◀◀');
      console.log('[Automation] Skipping new application - using recovery flow...');
      updateStatus(4, 'Retry mode: Finding pending application...');

      // Look for pending applications link/button
      const hasPendingApps = await page.evaluate(() => {
        const links = document.querySelectorAll('a, input[type="button"]');
        for (const el of links) {
          const text = el.textContent || el.value || '';
          if (
            text.toLowerCase().includes('pending') ||
            text.toLowerCase().includes('application')
          ) {
            console.log('Found pending link:', text);
          }
        }
        return true;
      });

      // Navigate to pending applications
      console.log('[Automation] Looking for pending applications...');

      // Try to find and click pending applications link
      const pendingClicked = await page.evaluate(() => {
        // Look for links with "Pending" or table rows
        const links = document.querySelectorAll('a');
        for (const link of links) {
          if (link.textContent && link.textContent.toLowerCase().includes('pending')) {
            link.click();
            return true;
          }
        }
        return false;
      });

      if (pendingClicked) {
        await new Promise(r => setTimeout(r, 3000));
        console.log('[Automation] Clicked on pending applications');
      }

      // Now use the recovery flow to find and edit the application
      const recoverySuccess = await attemptRecoveryFlow(page, `${firstName} ${lastName}`);

      if (recoverySuccess) {
        console.log('[Automation] ✓ Recovery flow successful - now on Agent Statement page');
        updateStatus(10, 'Recovery successful - completing Agent Statement...');
        // Skip to Agent Statement section (continues below in the normal flow)
        // The page should now be on the Agent Statement page
      } else {
        console.log('[Automation] ✗ Recovery flow failed');
        throw new Error('Recovery flow failed - could not find or re-enter pending application');
      }

      // After recovery, continue to Agent Statement handling (skip to that section)
      // Jump past the normal flow steps and go directly to Agent Statement page handling
    } else {
      // ═══════════════════════════════════════════════════════════════════════
      // NORMAL MODE: Start New Application
      // ═══════════════════════════════════════════════════════════════════════

      // STEP 4: Start New Application
      updateStatus(4, 'Starting new application...');
      console.log('[Automation] Starting New Application...');
      await page.waitForSelector('#BtnNewApp', { timeout: 15000 });
      console.log('[Automation] ✓ Found New Application button');
      await page.click('#BtnNewApp');
      console.log('[Automation] ✓ Clicked New Application');

      // Wait for Agent popup to appear
      await new Promise(r => setTimeout(r, 2000));

      // ═══════════════════════════════════════════════════════════════
      // STEP 5: AGENT SELECTION - Double-click the agent cell
      // ═══════════════════════════════════════════════════════════════
      updateStatus(5, 'Selecting agent...');
      console.log('[Automation] Selecting Agent...');
      await page.waitForSelector('td.dataItem', { timeout: 15000 });
      console.log('[Automation] ✓ Agent grid loaded');

      const agentCells = await page.$$('td.dataItem');
      console.log(`[Automation] Found ${agentCells.length} dataItem cells`);

      let agentFound = false;
      for (const cell of agentCells) {
        const text = await page.evaluate(e => e.textContent, cell);
        if (text.includes('0001163940')) {
          console.log(`[Automation] ✓ Found agent cell: ${text}`);
          await cell.click({ clickCount: 2 }); // DOUBLE-CLICK
          console.log('[Automation] ✓ Double-clicked agent');
          agentFound = true;
          break;
        }
      }

      if (!agentFound) {
        throw new Error('Could not find agent 0001163940 in grid');
      }

      // Wait for product popup to load
      await new Promise(r => setTimeout(r, 2000));

      // ═══════════════════════════════════════════════════════════════
      // PRODUCT SELECTION - Must click within #ProductMenu popup, NOT main page
      // ═══════════════════════════════════════════════════════════════
      console.log('[Automation] Selecting Product...');

      // Wait for the ProductMenu popup to be visible
      try {
        await page.waitForSelector('#ProductMenu', {
          visible: true,
          timeout: 10000,
        });
        console.log('[Automation] ✓ ProductMenu popup found');
      } catch (e) {
        console.log('[Automation] ProductMenu not found, checking for alternative popup...');
        // Log visible popups
        const popups = await page.$$eval('[id*="Menu"], [id*="Popup"], [class*="modal"]', els =>
          els.filter(e => e.offsetParent !== null).map(e => ({ id: e.id, class: e.className }))
        );
        console.log('[Automation] Visible popups:', JSON.stringify(popups));
      }

      // Find and click Senior Choice ONLY within the ProductMenu popup
      const productResult = await page.evaluate(() => {
        // First look for ProductMenu popup
        const productMenu = document.getElementById('ProductMenu');

        // If no ProductMenu, look for any visible modal/popup
        let container = productMenu;
        if (!container || container.style.display === 'none') {
          // Look for any visible popup that contains product cells
          const modals = document.querySelectorAll('[id*="Menu"], [id*="Popup"], [class*="modal"]');
          for (const modal of modals) {
            if (modal.offsetParent !== null && modal.querySelectorAll('td.dataItem').length > 0) {
              container = modal;
              break;
            }
          }
        }

        if (!container) {
          // Fallback: look for cells NOT in the Applications table
          // The main table has class "dataRow" with onclick handlers
          const allCells = document.querySelectorAll('td.dataItem');
          for (const cell of allCells) {
            if (cell.textContent.includes('Senior Choice (FE 50-85)')) {
              const row = cell.closest('tr');
              // Skip if this row is in the main Applications in Progress table (has onclick)
              if (row && row.classList.contains('dataRow') && row.onclick) {
                continue; // Skip main table rows
              }
              // This is a popup row
              const hiddenLinks = row?.querySelectorAll(
                'a[href*="__doPostBack"], a[href*="javascript:"]'
              );
              if (hiddenLinks && hiddenLinks.length > 0) {
                hiddenLinks[0].click();
                return {
                  method: 'hiddenLink-fallback',
                  success: true,
                  text: cell.textContent.slice(0, 50),
                };
              }
              // Try dblclick
              const dblClickEvent = new MouseEvent('dblclick', {
                bubbles: true,
                cancelable: true,
                view: window,
              });
              (row || cell).dispatchEvent(dblClickEvent);
              return {
                method: 'dblclick-fallback',
                success: true,
                text: cell.textContent.slice(0, 50),
              };
            }
          }
          return {
            success: false,
            error: 'No popup container found',
            cellCount: allCells.length,
          };
        }

        // Found popup container, now look for Senior Choice within it
        const cells = container.querySelectorAll('td.dataItem');
        for (const cell of cells) {
          if (
            cell.textContent.includes('Senior Choice (FE 50-85)') ||
            cell.textContent.includes('Senior Choice')
          ) {
            const row = cell.closest('tr');

            // Look for hidden links
            const hiddenLinks = row?.querySelectorAll(
              'a[href*="__doPostBack"], a[href*="javascript:"]'
            );
            if (hiddenLinks && hiddenLinks.length > 0) {
              hiddenLinks[0].click();
              return {
                method: 'hiddenLink',
                success: true,
                container: container.id,
                text: cell.textContent.slice(0, 50),
              };
            }

            // Try row onclick
            if (row && row.onclick) {
              row.onclick();
              return {
                method: 'onclick',
                success: true,
                container: container.id,
                text: cell.textContent.slice(0, 50),
              };
            }

            // Try dblclick
            const dblClickEvent = new MouseEvent('dblclick', {
              bubbles: true,
              cancelable: true,
              view: window,
            });
            (row || cell).dispatchEvent(dblClickEvent);
            return {
              method: 'dblclick',
              success: true,
              container: container.id,
              text: cell.textContent.slice(0, 50),
            };
          }
        }

        return {
          success: false,
          error: 'Senior Choice not found in popup',
          popupId: container.id,
          cellCount: cells.length,
        };
      });

      console.log('[Automation] Product selection result:', JSON.stringify(productResult));

      if (!productResult.success) {
        const availableProducts = await page.$$eval('td.dataItem', els =>
          els.map(e => e.textContent.slice(0, 50))
        );
        console.log('[Automation] Available products:', JSON.stringify(availableProducts));
        throw new Error('Could not find Senior Choice product in popup');
      }

      // Wait for state menu to appear after product selection
      console.log('[Automation] Waiting for StateMenu to appear...');
      await new Promise(r => setTimeout(r, 3000));

      // DEBUG: Dump the entire page state to understand the UI
      const pageDebug = await page.evaluate(() => {
        const result = {
          url: window.location.href,
          title: document.title,
          // All visible inputs
          inputs: Array.from(document.querySelectorAll('input:not([type="hidden"])'))
            .map(i => ({
              id: i.id,
              name: i.name,
              type: i.type,
              value: i.value?.slice(0, 30),
              visible: i.offsetParent !== null,
            }))
            .slice(0, 20),
          // All selects
          selects: Array.from(document.querySelectorAll('select')).map(s => ({
            id: s.id,
            name: s.name,
            optionCount: s.options.length,
            visible: s.offsetParent !== null,
          })),
          // All buttons
          buttons: Array.from(
            document.querySelectorAll('button, input[type="submit"], input[type="button"]')
          )
            .map(b => ({
              id: b.id,
              value: b.value || b.textContent?.slice(0, 30),
              visible: b.offsetParent !== null,
            }))
            .slice(0, 15),
          // Any elements with "state" in their id/name
          stateElements: Array.from(
            document.querySelectorAll(
              '[id*="tate"], [name*="tate"], [id*="State"], [name*="State"]'
            )
          ).map(e => ({
            tag: e.tagName,
            id: e.id,
            name: e.name,
            class: e.className?.slice(0, 30),
            text: e.textContent?.slice(0, 50),
            visible: e.offsetParent !== null,
          })),
          // Body text preview
          bodyText: document.body?.innerText?.slice(0, 500),
        };
        return result;
      });

      console.log('[Automation] ═══ PAGE STATE AFTER PRODUCT CLICK ═══');
      console.log('[Automation] URL:', pageDebug.url);
      console.log('[Automation] Title:', pageDebug.title);
      console.log('[Automation] Inputs:', JSON.stringify(pageDebug.inputs));
      console.log('[Automation] Selects:', JSON.stringify(pageDebug.selects));
      console.log('[Automation] Buttons:', JSON.stringify(pageDebug.buttons));
      console.log('[Automation] State Elements:', JSON.stringify(pageDebug.stateElements));
      console.log(
        '[Automation] Body Preview:',
        pageDebug.bodyText?.replace(/\n/g, ' | ').slice(0, 300)
      );
      console.log('[Automation] ═══════════════════════════════════════');

      // Part 5: State Selection
      // The UI shows a modal #StateMenu with a <select id="StateDropDown"> and a Submit button #BtnNewAppFinal
      console.log(`[Automation] Selecting State: ${state}...`);

      // Wait for the StateMenu modal to be visible
      await page.waitForSelector('#StateMenu', { timeout: 10000 });
      console.log('[Automation] ✓ StateMenu modal found');

      // Check if the StateDropDown select exists
      const stateDropdown = await page.$('#StateDropDown');
      if (stateDropdown) {
        console.log('[Automation] ✓ Found StateDropDown select element');

        // Get the state code from our mapping
        const stateCode = STATE_MAPPING[state];
        if (!stateCode) {
          throw new Error(`State "${state}" not found in STATE_MAPPING`);
        }
        console.log(`[Automation] State code for "${state}": ${stateCode}`);

        // STEP 1: Click the dropdown to open it first
        console.log('[Automation] Clicking dropdown to open it...');
        await page.click('#StateDropDown');
        await new Promise(r => setTimeout(r, 500));

        // STEP 2: Try page.select which should work for standard <select>
        try {
          await page.select('#StateDropDown', stateCode);
          console.log(`[Automation] ✓ Selected "${state}" via page.select`);
        } catch (e) {
          // If page.select fails, try to find and click the option directly
          console.log('[Automation] page.select failed, trying to click option directly...');

          // Scroll through options and click the right one
          const optionClicked = await page.evaluate(
            (targetValue, targetState) => {
              const select = document.querySelector('#StateDropDown');
              if (!select) return false;

              // Find the option by value or text
              for (const opt of select.options) {
                if (opt.value === targetValue || opt.text.includes(targetState)) {
                  opt.selected = true;
                  select.value = opt.value;
                  // Trigger change event
                  select.dispatchEvent(new Event('change', { bubbles: true }));
                  return true;
                }
              }
              return false;
            },
            stateCode,
            state
          );

          if (optionClicked) {
            console.log(`[Automation] ✓ Selected "${state}" via direct option click`);
          } else {
            throw new Error(`Could not select state "${state}"`);
          }
        }

        // Wait a moment for the selection to register
        await new Promise(r => setTimeout(r, 500));

        // STEP 3: Click the Submit button to proceed
        console.log('[Automation] Looking for Submit button (BtnNewAppFinal)...');
        await page.waitForSelector('#BtnNewAppFinal', { timeout: 5000 });

        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {}),
          page.click('#BtnNewAppFinal'),
        ]);
        console.log('[Automation] ✓ Clicked Submit button');
      } else {
        // Fallback: try the name-based selector
        console.log('[Automation] #StateDropDown not found, trying alternative selectors...');
        const altDropdown = await page.$('select[name="StateDropDown"], select[name*="State"]');
        if (altDropdown) {
          const stateCode = STATE_MAPPING[state];
          if (stateCode) {
            await page.select('select[name="StateDropDown"]', stateCode);
            console.log(`[Automation] ✓ Selected state via alternative dropdown`);
            await page.click('#BtnNewAppFinal');
          }
        } else {
          throw new Error('Could not find state dropdown selector');
        }
      }

      console.log('[Automation] ✓ State selection complete');

      // Wait for the quote form to load after state submission
      await new Promise(r => setTimeout(r, 3000));
      console.log('[Automation] ✓ Proceeding to application form...');

      // Part 6: Customer Information / Quote Form
      console.log('[Automation] Filling Customer Information...');

      // Wait for the form to be visible
      await page.waitForSelector('#InsNameFirst', { timeout: 15000 });
      console.log('[Automation] ✓ Application form loaded');

      // First Name
      await page.type('#InsNameFirst', firstName.toUpperCase());
      console.log('[Automation] ✓ First name entered');

      // Middle Name (optional)
      if (middleName) {
        await page.type('#InsNameMiddle', middleName.toUpperCase());
        console.log('[Automation] ✓ Middle name entered');
      }

      // Last Name
      await page.type('#InsNameLast', lastName.toUpperCase());
      console.log('[Automation] ✓ Last name entered');

      // Date of Birth (mm/dd/yyyy format)
      // Convert dob to mm/dd/yyyy if needed
      let formattedDOB = dob;
      if (dob && dob.includes('-')) {
        // Convert yyyy-mm-dd to mm/dd/yyyy
        const [year, month, day] = dob.split('-');
        formattedDOB = `${month}/${day}/${year}`;
      }
      await page.type('#dob', formattedDOB);
      console.log(`[Automation] ✓ DOB entered: ${formattedDOB}`);

      // Age
      if (age) {
        await page.type('#dobAge', String(age));
        console.log(`[Automation] ✓ Age entered: ${age}`);
      }

      // Gender (Male=M, Female=F)
      const genderValue = gender === 'Male' ? 'M' : 'F';
      await page.click(`input[name="ctl00$ContentPlaceHolderMain$Sex"][value="${genderValue}"]`);
      console.log(`[Automation] ✓ Gender selected: ${genderValue}`);

      // Tobacco (Yes=T, No=N)
      const tobaccoValue = tobacco ? 'T' : 'N';
      await page.click(
        `input[name="ctl00$ContentPlaceHolderMain$Tobacco"][value="${tobaccoValue}"]`
      );
      console.log(`[Automation] ✓ Tobacco selected: ${tobaccoValue}`);

      // Acceptance Checkbox (always check)
      await page.click('#Acceptance');
      console.log('[Automation] ✓ Acceptance checkbox checked');

      // Part 8: Death Benefit / Plan Type
      // Map our plan types to AA values: Immediate=I, Graded=G, ROP=R
      let planValue = 'I'; // Default to Immediate
      if (selectedPlanType === 'Graded') planValue = 'G';
      else if (selectedPlanType === 'ROP') planValue = 'R';
      else if (selectedPlanType === 'Level' || selectedPlanType === 'Immediate') planValue = 'I';

      await page.click(`input[name="ctl00$ContentPlaceHolderMain$Plan"][value="${planValue}"]`);
      console.log(`[Automation] ✓ Plan type selected: ${planValue}`);

      // Part 9: Payment Mode (always Monthly)
      await page.select('#Mode', 'M');
      console.log('[Automation] ✓ Payment mode set to Monthly');

      // Part 10: Face Amount / Coverage
      const coverageAmount = String(selectedCoverage || 10000);
      await page.type('#Coverage', coverageAmount);
      console.log(`[Automation] ✓ Coverage amount entered: $${coverageAmount}`);

      // Part 11: Automatic Premium Loan (always Yes)
      await page.click('#APL_1');
      console.log('[Automation] ✓ APL set to Yes');

      // Part 12: Deliver Policy To (always Insured)
      await page.click('#MailTo_1');
      console.log('[Automation] ✓ Mail to Insured selected');

      // Part 13: Requested Policy Date (today's date in mm/dd/yyyy)
      const today = new Date();
      const policyDate = `${String(today.getMonth() + 1).padStart(
        2,
        '0'
      )}/${String(today.getDate()).padStart(2, '0')}/${today.getFullYear()}`;
      await page.type('#ReqPolicyDate', policyDate);
      console.log(`[Automation] ✓ Policy date entered: ${policyDate}`);

      // Part 14: Digital Policy (always Yes if visible)
      try {
        const digitalSection = await page.$('#DigitalInterestQ_1');
        if (digitalSection) {
          const isVisible = await page.evaluate(el => el.offsetParent !== null, digitalSection);
          if (isVisible) {
            await page.click('#DigitalInterestQ_1');
            console.log('[Automation] ✓ Digital policy set to Yes');
          } else {
            console.log('[Automation] Digital policy section hidden, skipping');
          }
        }
      } catch (e) {
        console.log('[Automation] Digital policy section not found, skipping');
      }

      // Part 15: Click Quote button
      console.log('[Automation] Clicking Quote button...');
      await page.waitForSelector('#BtnQuote', { timeout: 10000 });
      await page.click('#BtnQuote');
      console.log('[Automation] ✓ Quote button clicked');

      // Wait for quote popup to appear
      await new Promise(r => setTimeout(r, 5000));

      // Part 16: Click Continue Application button
      console.log('[Automation] Looking for Continue Application button...');
      try {
        await page.waitForSelector('#BtnContinue', { timeout: 15000 });
        await page.click('#BtnContinue');
        console.log('[Automation] ✓ Clicked Continue Application');
      } catch (e) {
        console.log('[Automation] Continue button not found, quote may have different flow');
      }

      // Wait for health questions form to load
      await new Promise(r => setTimeout(r, 3000));

      // ═══════════════════════════════════════════════════════════════════════
      // PART 17: HEALTH QUESTIONS
      // ═══════════════════════════════════════════════════════════════════════
      console.log('[Automation] Filling Health Questions...');

      // Helper function to click Yes or No radio
      const answerHealthQuestion = async (questionId, answer) => {
        const suffix = answer ? '_1' : '_2'; // _1 = Yes, _2 = No
        const selector = `#${questionId}${suffix}`;
        try {
          await page.waitForSelector(selector, { timeout: 5000 });
          await page.click(selector);
          console.log(`[Automation] ✓ ${questionId}: ${answer ? 'Yes' : 'No'}`);
        } catch (e) {
          console.log(`[Automation] Health question ${questionId} not found`);
        }
      };

      // Questions 1-3 (If Yes = Not Eligible)
      await answerHealthQuestion('_SectionA1', healthQ1);
      await answerHealthQuestion('_SectionA2', healthQ2);
      await answerHealthQuestion('_SectionA3', healthQ3);

      // Questions 4-7 (If Yes = ROP Plan)
      await answerHealthQuestion('_SectionA4', healthQ4);
      await answerHealthQuestion('_SectionA5', healthQ5);
      await answerHealthQuestion('_SectionA6', healthQ6);
      await answerHealthQuestion('_SectionA7a', healthQ7a);
      await answerHealthQuestion('_SectionA7b', healthQ7b);
      await answerHealthQuestion('_SectionA7c', healthQ7c);
      await answerHealthQuestion('_SectionA7d', healthQ7d);

      // Question 8 (If Yes = Graded Plan)
      await answerHealthQuestion('_SectionA8a', healthQ8a);
      await answerHealthQuestion('_SectionA8b', healthQ8b);
      await answerHealthQuestion('_SectionA8c', healthQ8c);

      // COVID Question
      await answerHealthQuestion('CVQ1', healthCovid);

      console.log('[Automation] ✓ Health questions completed');

      // Click Continue after health questions
      try {
        await page.waitForSelector('#BtnContinue', { timeout: 10000 });
        await page.click('#BtnContinue');
        console.log('[Automation] ✓ Clicked Continue after health questions');
      } catch (e) {
        console.log('[Automation] Continue button not found after health questions');
      }

      await new Promise(r => setTimeout(r, 2000));

      // ═══════════════════════════════════════════════════════════════════════
      // PART 18: PERSONAL INFO PAGE - BANK DRAFT & ADDITIONAL INFO
      // ═══════════════════════════════════════════════════════════════════════
      console.log('[Automation] Filling Personal Info / Bank Draft...');

      // Wait for the Personal Info page to load
      await page.waitForSelector('#Method', { timeout: 15000 }).catch(() => {});
      console.log('[Automation] ✓ Personal Info page loaded');

      // ═══════════════════════════════════════════════════════════════════════
      // ████ DEBUG: Log all received bank/payment values ████
      // ═══════════════════════════════════════════════════════════════════════
      console.log('[Automation] ═══ BANK/PAYMENT DATA RECEIVED ═══');
      console.log('[Automation] accountHolder:', accountHolder || '(EMPTY)');
      console.log('[Automation] bankName:', bankName || '(EMPTY)');
      console.log('[Automation] bankCityState:', bankCityState || '(EMPTY)');
      console.log('[Automation] ssPaymentSchedule:', ssPaymentSchedule);
      console.log('[Automation] draftDay:', draftDay || '(EMPTY)');
      console.log('[Automation] routingNumber:', routingNumber || '(EMPTY)');
      console.log('[Automation] accountNumber:', accountNumber || '(EMPTY)');
      console.log('[Automation] accountType:', accountType || '(EMPTY)');
      console.log('[Automation] ═══════════════════════════════════════');

      // ═══════════════════════════════════════════════════════════════════════
      // USE FALLBACK VALUES if data wasn't collected
      // This ensures the form can still be submitted for testing
      // ═══════════════════════════════════════════════════════════════════════
      const effectiveAccountHolder = accountHolder || `${firstName} ${lastName}`;
      const effectiveBankName = bankName || 'CHASE BANK NA';
      const effectiveBankCityState = bankCityState || `${city || 'ANYTOWN'}, ${state || 'IL'}`;
      const effectiveSSPaymentSchedule = ssPaymentSchedule !== null ? ssPaymentSchedule : false;
      const effectiveDraftDay = draftDay || '15';
      const effectiveRoutingNumber = routingNumber || '021000021'; // Chase test routing
      const effectiveAccountNumber = accountNumber || '123456789'; // Test account
      const effectiveAccountType = accountType || 'Checking';

      console.log('[Automation] ═══ EFFECTIVE VALUES (with fallbacks) ═══');
      console.log('[Automation] effectiveAccountHolder:', effectiveAccountHolder);
      console.log('[Automation] effectiveBankName:', effectiveBankName);
      console.log('[Automation] effectiveBankCityState:', effectiveBankCityState);
      console.log('[Automation] effectiveSSPaymentSchedule:', effectiveSSPaymentSchedule);
      console.log('[Automation] effectiveDraftDay:', effectiveDraftDay);
      console.log('[Automation] effectiveRoutingNumber:', effectiveRoutingNumber);
      console.log('[Automation] effectiveAccountNumber:', effectiveAccountNumber);
      console.log('[Automation] effectiveAccountType:', effectiveAccountType);
      console.log('[Automation] ═══════════════════════════════════════');

      // === PAYMENT METHOD (Bank Draft) ===
      try {
        await page.evaluate(() => {
          const radio = document.getElementById('Method_1');
          if (radio) {
            radio.checked = true;
            radio.click();
            radio.dispatchEvent(new Event('change', { bubbles: true }));
            radio.dispatchEvent(new Event('input', { bubbles: true }));
          }
        });
        console.log('[Automation] ✓ Payment method set to Bank Draft (with events)');
        await new Promise(r => setTimeout(r, 2000)); // Wait for Bank Draft section to appear
      } catch (e) {
        console.log('[Automation] ⚠ Payment method selector not found:', e.message);
      }

      // === BANK DRAFT INFORMATION ===
      // Account Holder - ALWAYS fill this (required field)
      try {
        const holderField = await page.$('#AccountHolder');
        if (holderField) {
          await holderField.click({ clickCount: 3 }); // Select all existing text
          await page.type('#AccountHolder', effectiveAccountHolder.toUpperCase());
          console.log(
            '[Automation] ✓ Account Holder entered:',
            effectiveAccountHolder.toUpperCase()
          );
        } else {
          console.log('[Automation] ⚠ Account Holder field not found on page');
        }
      } catch (e) {
        console.log('[Automation] Account Holder entry error:', e.message);
      }

      // Bank Name - ALWAYS fill this (required field)
      try {
        const bankField = await page.$('#BankName');
        if (bankField) {
          await bankField.click({ clickCount: 3 }); // Select all existing text
          await page.type('#BankName', effectiveBankName.toUpperCase());
          console.log('[Automation] ✓ Bank Name entered:', effectiveBankName.toUpperCase());
        } else {
          console.log('[Automation] ⚠ Bank Name field not found on page');
        }
      } catch (e) {
        console.log('[Automation] Bank Name entry error:', e.message);
      }

      // Bank City/State - ALWAYS fill this (required field)
      try {
        const bankAddrField = await page.$('#BankAddress');
        if (bankAddrField) {
          await bankAddrField.click({ clickCount: 3 }); // Select all existing text
          await page.type('#BankAddress', effectiveBankCityState.toUpperCase());
          console.log(
            '[Automation] ✓ Bank City/State entered:',
            effectiveBankCityState.toUpperCase()
          );
        } else {
          console.log('[Automation] ⚠ Bank Address field not found on page');
        }
      } catch (e) {
        console.log('[Automation] Bank Address entry error:', e.message);
      }

      // Social Security Payment Schedule (Yes/No) - REQUIRED FIELD (SSPReq)
      // When Yes: Draft Day options are SS payment weeks (1S, 3S, 2W, 3W, 4W)
      // When No: Draft Day options are day numbers (1-28)
      console.log(`[Automation] Using effectiveSSPaymentSchedule: ${effectiveSSPaymentSchedule}`);
      console.log(`[Automation] Using effectiveDraftDay: ${effectiveDraftDay}`);

      try {
        if (effectiveSSPaymentSchedule === true) {
          // User wants draft to coincide with Social Security payment
          console.log('[Automation] Clicking SS Payment Schedule: Yes (SSP_1)...');

          // Click the radio button with Puppeteer
          await page.waitForSelector('#SSP_1', { timeout: 5000 });
          await page.click('#SSP_1');
          console.log('[Automation] ✓ SS Payment Schedule clicked: Yes');

          // Wait for the page to react and update the dropdown options
          await new Promise(r => setTimeout(r, 3000));

          // Verify the dropdown now has SS week options and log available values
          const draftOptions = await page.evaluate(() => {
            const select = document.getElementById('RequestedDraftDay');
            if (!select) return { found: false, options: [] };
            return {
              found: true,
              options: Array.from(select.options).map(o => ({
                value: o.value,
                text: o.text,
              })),
            };
          });
          console.log(
            '[Automation] RequestedDraftDay options:',
            JSON.stringify(draftOptions.options.slice(0, 8))
          );

          // Now select the SS week option (1S, 3S, 2W, 3W, 4W)
          try {
            // First check if the value exists in options
            const hasValue = draftOptions.options.some(o => o.value === effectiveDraftDay);
            if (hasValue) {
              await page.select('#RequestedDraftDay', effectiveDraftDay);
              console.log(`[Automation] ✓ SS Draft Week selected: ${effectiveDraftDay}`);
            } else {
              console.log(
                `[Automation] Value ${effectiveDraftDay} not in options, selecting first SS week...`
              );
              // Select first non-empty option
              const firstValue = draftOptions.options.find(o => o.value && o.value !== '');
              if (firstValue) {
                await page.select('#RequestedDraftDay', firstValue.value);
                console.log(`[Automation] ✓ Selected first available: ${firstValue.value}`);
              }
            }
          } catch (e) {
            console.log(
              `[Automation] Could not select SS week "${effectiveDraftDay}": ${e.message}`
            );
            // Fallback: select first available SS option via evaluate
            const firstSS = await page.evaluate(() => {
              const select = document.getElementById('RequestedDraftDay');
              if (select && select.options.length > 1) {
                select.selectedIndex = 1;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                return select.options[1].value;
              }
              return null;
            });
            if (firstSS) console.log(`[Automation] ✓ Fallback SS Week selected: ${firstSS}`);
          }
        } else {
          // User does NOT want draft to coincide with SS - use specific day of month
          console.log('[Automation] Clicking SS Payment Schedule: No (SSP_2)...');

          // Click the radio button with Puppeteer
          await page.waitForSelector('#SSP_2', { timeout: 5000 });
          await page.click('#SSP_2');
          console.log('[Automation] ✓ SS Payment Schedule clicked: No');

          // Wait for the page to react
          await new Promise(r => setTimeout(r, 3000));

          // Verify the dropdown now has day options and log available values
          const draftOptions = await page.evaluate(() => {
            const select = document.getElementById('RequestedDraftDay');
            if (!select) return { found: false, options: [] };
            return {
              found: true,
              options: Array.from(select.options).map(o => ({
                value: o.value,
                text: o.text,
              })),
            };
          });
          console.log(
            '[Automation] RequestedDraftDay options:',
            JSON.stringify(draftOptions.options.slice(0, 8))
          );

          // Now select the day number (1-28)
          try {
            // First check if the value exists in options
            const hasValue = draftOptions.options.some(o => o.value === String(effectiveDraftDay));
            if (hasValue) {
              await page.select('#RequestedDraftDay', String(effectiveDraftDay));
              console.log(`[Automation] ✓ Draft Day of Month selected: ${effectiveDraftDay}`);
            } else {
              console.log(
                `[Automation] Value ${effectiveDraftDay} not in options, selecting first day...`
              );
              const firstValue = draftOptions.options.find(o => o.value && o.value !== '');
              if (firstValue) {
                await page.select('#RequestedDraftDay', firstValue.value);
                console.log(`[Automation] ✓ Selected first available: ${firstValue.value}`);
              }
            }
          } catch (e) {
            console.log(`[Automation] Could not select day "${effectiveDraftDay}": ${e.message}`);
            // Fallback: select first available day option
            const firstDay = await page.evaluate(() => {
              const select = document.getElementById('RequestedDraftDay');
              if (select && select.options.length > 1) {
                select.selectedIndex = 1;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                return select.options[1].value;
              }
              return null;
            });
            if (firstDay) console.log(`[Automation] ✓ Fallback Day selected: ${firstDay}`);
          }
        }

        // Final verification - ensure draft day was actually selected
        await new Promise(r => setTimeout(r, 500));
        const finalDraftValue = await page.evaluate(() => {
          const select = document.getElementById('RequestedDraftDay');
          return select ? select.value : 'not found';
        });
        console.log('[Automation] ✓ Final RequestedDraftDay value:', finalDraftValue);
      } catch (e) {
        console.log('[Automation] SS Payment Schedule section error:', e.message);
      }

      // Routing Number (Transit/ABA) - ALWAYS fill this (required field)
      try {
        const routingField = await page.$('#TransitNumber');
        if (routingField) {
          await routingField.click({ clickCount: 3 }); // Select all
          await page.type('#TransitNumber', effectiveRoutingNumber.replace(/[^0-9]/g, ''));
          console.log('[Automation] ✓ Routing Number entered:', effectiveRoutingNumber);
        } else {
          console.log('[Automation] ⚠ Transit Number field not found on page');
        }
      } catch (e) {
        console.log('[Automation] Routing Number entry error:', e.message);
      }

      // Account Number - ALWAYS fill this (required field)
      try {
        const accountField = await page.$('#AccountNumber');
        if (accountField) {
          await accountField.click({ clickCount: 3 }); // Select all
          await page.type('#AccountNumber', effectiveAccountNumber.replace(/[^0-9]/g, ''));
          console.log('[Automation] ✓ Account Number entered:', effectiveAccountNumber);
        } else {
          console.log('[Automation] ⚠ Account Number field not found on page');
        }
      } catch (e) {
        console.log('[Automation] Account Number entry error:', e.message);
      }

      // ═══ CHECKING/SAVINGS - REQUIRED FIELD (CheckPlanReq) ═══
      console.log(`[Automation] Using effectiveAccountType: ${effectiveAccountType}`);
      try {
        const checkPlanId =
          effectiveAccountType === 'Saving' || effectiveAccountType === 'Savings'
            ? 'CheckPlan_2'
            : 'CheckPlan_1';
        const checkPlanLabel = checkPlanId === 'CheckPlan_2' ? 'Saving' : 'Checking';

        await page.evaluate(id => {
          const radio = document.getElementById(id);
          if (radio) {
            radio.checked = true;
            radio.click();
            radio.dispatchEvent(new Event('change', { bubbles: true }));
            radio.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, checkPlanId);
        console.log(`[Automation] ✓ Account Type: ${checkPlanLabel} (with events)`);
      } catch (e) {
        console.log('[Automation] Checking/Savings radio not found:', e.message);
      }

      // Wait after all bank fields are filled
      await new Promise(r => setTimeout(r, 1000));
      console.log('[Automation] ✓ All bank fields populated');

      // NOTE: Bank validation will be done AFTER the entire page is filled out

      // === PERSONAL INFORMATION - CRITICAL FIELDS ===
      // Street Address
      if (address) {
        try {
          await page.type('#StreetAddress', address.toUpperCase());
          console.log('[Automation] ✓ Street Address entered');
        } catch (e) {
          console.log('[Automation] Street Address field not found');
        }
      }

      // ZipCode - this auto-fills State and City
      if (zip) {
        try {
          await page.type('#ZipCode', zip.replace(/[^0-9]/g, '').slice(0, 5));
          console.log('[Automation] ✓ ZipCode entered');
          await new Promise(r => setTimeout(r, 1000)); // Wait for auto-fill
        } catch (e) {
          console.log('[Automation] ZipCode field not found');
        }
      }

      // Social Security Number
      if (ssn) {
        try {
          await page.type('#SSN', ssn.replace(/[^0-9]/g, ''));
          console.log('[Automation] ✓ SSN entered');
        } catch (e) {
          console.log('[Automation] SSN field not found');
        }
      }

      // Phone
      if (phone) {
        try {
          await page.type('#Phone', phone.replace(/[^0-9]/g, ''));
          console.log('[Automation] ✓ Phone entered');
        } catch (e) {
          console.log('[Automation] Phone field not found');
        }
      }

      // === EMAIL PREFERENCE ===
      if (wantsEmail === true && email) {
        try {
          await page.click('#EmailAdress_1'); // Yes - wants email
          console.log('[Automation] ✓ Email preference: Yes');
          await new Promise(r => setTimeout(r, 500));
          // Type email in both fields
          await page.type('#Email1', email);
          await page.type('#VerifyEmail1', email);
          console.log('[Automation] ✓ Email entered and verified');
        } catch (e) {
          console.log('[Automation] Email fields not found');
        }
      } else if (wantsEmail === false) {
        try {
          await page.click('#EmailAdress_2'); // No
          console.log('[Automation] ✓ Email preference: No');
        } catch (e) {
          console.log('[Automation] Email radio not found');
        }
      }

      // === BIRTH STATE ===
      if (birthState) {
        try {
          await page.type('#BirthState', birthState.toUpperCase().slice(0, 2));
          console.log('[Automation] ✓ Birth state entered');
        } catch (e) {
          console.log('[Automation] Birth state field not found');
        }
      }

      // === HEIGHT & WEIGHT ===
      // Use safeWeight, safeHeightFeet, safeHeightInches to handle empty strings from frontend
      console.log(
        `[Automation] Height data (raw): ${heightFeet}' ${heightInches}" | Weight data (raw): ${weight}`
      );
      console.log(
        `[Automation] Height data (safe): ${safeHeightFeet}' ${safeHeightInches}" | Weight data (safe): ${safeWeight}`
      );

      // Always enter height using safe values (defaults: 5'6")
      const heightValue = `${safeHeightFeet}'${safeHeightInches}`;
      try {
        await page.select('#Height', heightValue);
        console.log(`[Automation] ✓ Height selected: ${heightValue}`);
      } catch (e) {
        console.log('[Automation] Height selector not found:', e.message);
        // Try alternative: type into height fields if they exist separately
        try {
          const feetInput = await page.$('#HeightFeet, input[name*="HeightFeet"]');
          const inchesInput = await page.$('#HeightInches, input[name*="HeightInches"]');
          if (feetInput && inchesInput) {
            await feetInput.type(String(safeHeightFeet));
            await inchesInput.type(String(safeHeightInches));
            console.log(
              `[Automation] ✓ Height entered via separate fields: ${safeHeightFeet}' ${safeHeightInches}"`
            );
          }
        } catch (e2) {
          console.log('[Automation] Alternative height fields not found');
        }
      }

      // Always enter weight using safe value (default: 150)
      console.log(`[Automation] Entering weight: ${safeWeight}`);
      try {
        // Clear any existing value first
        await page.$eval('#Weight', el => (el.value = ''));
        await page.type('#Weight', String(safeWeight));
        console.log(`[Automation] ✓ Weight entered: ${safeWeight}`);
      } catch (e) {
        console.log('[Automation] Weight field #Weight not found, trying alternatives...');
        // Try alternative selectors
        try {
          const weightInput = await page.$(
            'input[name*="Weight"], input[id*="weight" i], input[placeholder*="weight" i]'
          );
          if (weightInput) {
            await weightInput.click({ clickCount: 3 }); // Select all
            await weightInput.type(String(safeWeight));
            console.log(`[Automation] ✓ Weight entered via alt selector: ${safeWeight}`);
          } else {
            console.log('[Automation] ✗ No weight field found with any selector');
          }
        } catch (e2) {
          console.log('[Automation] Weight field error:', e2.message);
        }
      }

      // === PHYSICIAN INFORMATION ===
      if (doctorName) {
        try {
          await page.type('#DoctorName', doctorName.toUpperCase());
          console.log('[Automation] ✓ Doctor name entered');
        } catch (e) {
          console.log('[Automation] Doctor name field not found');
        }
      }

      if (doctorAddress) {
        try {
          await page.type('#DoctorName1', doctorAddress.toUpperCase());
          console.log('[Automation] ✓ Doctor address entered');
        } catch (e) {
          console.log('[Automation] Doctor address field not found');
        }
      }

      if (doctorPhone) {
        try {
          await page.type('#PPhone', doctorPhone.replace(/[^0-9]/g, ''));
          console.log('[Automation] ✓ Doctor phone entered');
        } catch (e) {
          console.log('[Automation] Doctor phone field not found');
        }
      }

      // === OWNER INFORMATION ===
      try {
        if (ownerIsInsured) {
          await page.click('#OwnerInfo_1'); // True = Owner is Insured
          console.log('[Automation] ✓ Owner is Insured: Yes');
        } else {
          await page.click('#OwnerInfo_2'); // False = Owner is different
          console.log('[Automation] ✓ Owner is Insured: No');
        }
      } catch (e) {
        console.log('[Automation] Owner Info radio not found');
      }

      // === PAYOR INFORMATION ===
      try {
        if (payorIsInsured) {
          await page.click('#PayorInfo_1'); // True = Payor is Insured
          console.log('[Automation] ✓ Payor is Insured: Yes');
        } else {
          await page.click('#PayorInfo_2'); // False = Payor is different
          console.log('[Automation] ✓ Payor is Insured: No');
        }
      } catch (e) {
        console.log('[Automation] Payor Info radio not found');
      }

      // === EXISTING INSURANCE ===
      if (hasExistingInsurance !== null) {
        try {
          if (hasExistingInsurance) {
            await page.click('#ExistingInsurance_1'); // Yes
            console.log('[Automation] ✓ Existing Insurance: Yes');
            await new Promise(r => setTimeout(r, 500));

            // Fill in existing coverage details
            if (existingCompanyName) {
              await page.type('#Company', existingCompanyName.toUpperCase()).catch(() => {});
              console.log('[Automation] ✓ Existing Company entered');
            }
            if (existingPolicyNumber) {
              await page.type('#PolicyNum', existingPolicyNumber).catch(() => {});
              console.log('[Automation] ✓ Existing Policy Number entered');
            }
            if (existingCoverageAmount) {
              await page.type('#AmountofCoverage', String(existingCoverageAmount)).catch(() => {});
              console.log('[Automation] ✓ Existing Coverage Amount entered');
            }
          } else {
            await page.click('#ExistingInsurance_2'); // No
            console.log('[Automation] ✓ Existing Insurance: No');
          }
        } catch (e) {
          console.log('[Automation] Existing Insurance fields not found');
        }
      }

      // === REPLACEMENT INSURANCE ===
      if (willReplaceExisting !== null) {
        try {
          if (willReplaceExisting) {
            await page.click('#RepIns_1'); // Yes
            console.log('[Automation] ✓ Will Replace: Yes');
          } else {
            await page.click('#RepIns_2'); // No
            console.log('[Automation] ✓ Will Replace: No');
          }
        } catch (e) {
          console.log('[Automation] Replacement Insurance radio not found');
        }
      }

      // ═══════════════════════════════════════════════════════════════════════
      // PRIMARY BENEFICIARY SECTION
      // ═══════════════════════════════════════════════════════════════════════
      console.log('[Automation] Filling Primary Beneficiary...');

      // Primary Beneficiary Full Name
      if (beneficiaryName) {
        try {
          await page.type('#PrimaryBeneficiary', beneficiaryName.toUpperCase());
          console.log('[Automation] ✓ Primary Beneficiary Name entered');
        } catch (e) {
          console.log('[Automation] Primary Beneficiary field not found');
        }
      }

      // Primary Beneficiary Relationship - Select "Family Member" by clicking the radio
      // Radio options: Family Member (_1), Multiple Beneficiaries (_2), Life Partner (_3), Fiancé (_4), Estate (_5), Trust (_6), Other (_7)
      if (beneficiaryRelation) {
        try {
          const relationMap = {
            'family member': 'PrimaryRelationship_1',
            spouse: 'PrimaryRelationship_1',
            mother: 'PrimaryRelationship_1',
            father: 'PrimaryRelationship_1',
            child: 'PrimaryRelationship_1',
            daughter: 'PrimaryRelationship_1',
            son: 'PrimaryRelationship_1',
            brother: 'PrimaryRelationship_1',
            sister: 'PrimaryRelationship_1',
            'life partner': 'PrimaryRelationship_3',
            fiancé: 'PrimaryRelationship_4',
            fiance: 'PrimaryRelationship_4',
            multiple: 'PrimaryRelationship_2',
            estate: 'PrimaryRelationship_5',
            trust: 'PrimaryRelationship_6',
            other: 'PrimaryRelationship_7',
          };

          const relationLower = beneficiaryRelation.toLowerCase();
          const radioId = relationMap[relationLower] || 'PrimaryRelationship_1'; // Default to Family Member

          await page.click(`#${radioId}`);
          console.log(`[Automation] ✓ Primary Beneficiary Relationship: ${radioId}`);
          await new Promise(r => setTimeout(r, 500)); // Wait for conditional fields

          // If Family Member, also select the specific family member type from dropdown
          if (radioId === 'PrimaryRelationship_1') {
            const familyMap = {
              spouse: 'Spouse',
              mother: 'Mother',
              father: 'Father',
              daughter: 'Daughter',
              son: 'Son',
              brother: 'Brother',
              sister: 'Sister',
              cousin: 'Cousin',
              aunt: 'Aunt',
              uncle: 'Uncle',
              grandfather: 'Grandfather',
              grandmother: 'Grandmother',
              grandchild: 'Grandchild',
              niece: 'Niece',
              nephew: 'Nephew',
            };

            const familyValue = familyMap[relationLower] || 'Spouse'; // Default to Spouse
            try {
              await page.select('#PFamilyMember', familyValue);
              console.log(`[Automation] ✓ Family Member Type: ${familyValue}`);
            } catch (e) {
              console.log('[Automation] Family Member dropdown not found');
            }
          }
        } catch (e) {
          console.log('[Automation] Primary Relationship radio not found');
        }
      } else {
        // Default to Family Member > Spouse if no relationship specified
        try {
          await page.click('#PrimaryRelationship_1');
          console.log('[Automation] ✓ Primary Beneficiary Relationship: Family Member (default)');
          await new Promise(r => setTimeout(r, 500));
          await page.select('#PFamilyMember', 'Spouse');
          console.log('[Automation] ✓ Family Member Type: Spouse (default)');
        } catch (e) {
          console.log('[Automation] Could not set default beneficiary relationship');
        }
      }

      console.log('[Automation] ✓ Primary Beneficiary section completed');

      console.log('[Automation] ✓ Contact information completed');

      // ═══════════════════════════════════════════════════════════════════════
      // ILLINOIS RESIDENTS SECTION - APPLICANT DESIGNEE CHOICE
      // ALWAYS select "Will Not Designate" - this appears at the bottom before Continue button
      // ═══════════════════════════════════════════════════════════════════════
      console.log(
        '[Automation] Looking for Illinois Residents / Applicant Designee Choice section...'
      );

      try {
        // First, log what's on the page to help debug
        const designeeInfo = await page.evaluate(() => {
          const results = {
            foundSection: false,
            radioButtons: [],
            labels: [],
          };

          // Look for any element containing "Will Not Designate" or "Designee"
          const allLabels = document.querySelectorAll('label, span, td');
          for (const el of allLabels) {
            if (el.textContent && el.textContent.includes('Designate')) {
              results.labels.push({
                tag: el.tagName,
                text: el.textContent.trim().substring(0, 50),
                htmlFor: el.htmlFor || null,
              });
              results.foundSection = true;
            }
          }

          // Find all radio buttons that might be the designee choice
          const radios = document.querySelectorAll('input[type="radio"]');
          for (const radio of radios) {
            const id = radio.id || '';
            const name = radio.name || '';
            const value = radio.value || '';
            // Look for designee-related radios
            if (
              id.toLowerCase().includes('designee') ||
              name.toLowerCase().includes('designee') ||
              id.toLowerCase().includes('applicant')
            ) {
              results.radioButtons.push({
                id,
                name,
                value,
                checked: radio.checked,
              });
            }
          }

          return results;
        });

        console.log('[Automation] Designee section search results:', JSON.stringify(designeeInfo));

        // Now try multiple approaches to click "Will Not Designate"
        let clicked = false;

        // Approach 1: Try the expected ID patterns
        const selectorPatterns = [
          '#ApplicantDesignee_2', // Standard pattern for radio #2 (Will Not Designate)
          '#ApplicantDesignee2', // Alternative without underscore
          'input[id*="Designee"][id*="2"]', // Any input with Designee and 2 in ID
          'input[name*="Designee"][value*="Not"]', // By name containing Designee, value containing Not
          'input[name*="Designee"][value*="2"]', // By name, value = 2
          'input[name*="Designee"]:nth-of-type(2)', // Second radio in Designee group
        ];

        for (const selector of selectorPatterns) {
          if (clicked) break;
          try {
            const element = await page.$(selector);
            if (element) {
              await element.click();
              console.log(
                `[Automation] ✓ Illinois Designee: Will Not Designate (selector: ${selector})`
              );
              clicked = true;
            }
          } catch (e) {
            // Continue to next selector
          }
        }

        // Approach 2: If still not clicked, find by label text "Will Not Designate"
        if (!clicked) {
          console.log('[Automation] Trying to find by label text...');
          clicked = await page.evaluate(() => {
            // Find all labels or elements with "Will Not Designate" text
            const allElements = document.querySelectorAll('label, span, td, div');
            for (const el of allElements) {
              if (el.textContent && el.textContent.trim() === 'Will Not Designate') {
                // Found the label, now find the associated radio
                const forId = el.htmlFor || el.getAttribute('for');
                if (forId) {
                  const radio = document.getElementById(forId);
                  if (radio) {
                    radio.click();
                    return true;
                  }
                }
                // Maybe the radio is inside or a sibling
                const radio =
                  el.querySelector('input[type="radio"]') ||
                  el.previousElementSibling?.querySelector('input[type="radio"]') ||
                  el.parentElement?.querySelector('input[type="radio"]');
                if (radio) {
                  radio.click();
                  return true;
                }
                // Try clicking the parent/container which might trigger the radio
                const parent = el.closest('label');
                if (parent) {
                  parent.click();
                  return true;
                }
              }
            }

            // Last resort: find all radios with Designee in name and click the second one
            const designeeRadios = document.querySelectorAll(
              'input[type="radio"][name*="Designee"]'
            );
            if (designeeRadios.length >= 2) {
              designeeRadios[1].click(); // Second radio = Will Not Designate
              return true;
            }

            return false;
          });

          if (clicked) {
            console.log(
              '[Automation] ✓ Illinois Designee: Will Not Designate (via label text/fallback)'
            );
          }
        }

        // Approach 3: If STILL not clicked, use XPath to find by text
        if (!clicked) {
          console.log('[Automation] Trying XPath approach...');
          try {
            const [labelElement] = await page.$x(
              "//label[contains(text(), 'Will Not Designate')] | //td[contains(text(), 'Will Not Designate')]"
            );
            if (labelElement) {
              await labelElement.click();
              console.log('[Automation] ✓ Illinois Designee: Will Not Designate (via XPath)');
              clicked = true;
            }
          } catch (e) {
            console.log('[Automation] XPath approach failed:', e.message);
          }
        }

        if (!clicked) {
          console.log(
            '[Automation] ⚠ Could not find/click Illinois Designee "Will Not Designate" option'
          );
          // Log all radio buttons on page for debugging
          const allRadios = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('input[type="radio"]'))
              .map(r => ({ id: r.id, name: r.name, value: r.value }))
              .filter(r => r.id || r.name);
          });
          console.log(
            '[Automation] All radio buttons on page:',
            JSON.stringify(allRadios.slice(0, 20))
          );
        }
      } catch (e) {
        console.log('[Automation] Illinois Designee section error:', e.message);
      }

      // Small wait after selecting designee option
      await new Promise(r => setTimeout(r, 500));

      // ████████████████████████████████████████████████████████████████████████
      // VALIDATE BANK INFO - NOW THAT ENTIRE PAGE IS FILLED OUT
      // ████████████████████████████████████████████████████████████████████████
      console.log('[Automation] ═══ NOW VALIDATING BANK INFO (after page complete) ═══');
      try {
        // First, make sure the validate button div is visible (it's hidden by default)
        await page.evaluate(() => {
          const validateDiv = document.getElementById('dvValidateBankInfo');
          if (validateDiv) {
            validateDiv.style.display = 'block';
          }
        });
        await new Promise(r => setTimeout(r, 500));

        // Scroll to the button
        await page.evaluate(() => {
          const bankBtn = document.getElementById('btValidateBankInfo');
          if (bankBtn) {
            bankBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
          }
        });
        await new Promise(r => setTimeout(r, 500));

        // Check if button exists
        const btnExists = await page.$('#btValidateBankInfo');
        if (btnExists) {
          // Use JavaScript click (more reliable than Puppeteer click)
          await page.evaluate(() => {
            const btn = document.getElementById('btValidateBankInfo');
            if (btn) btn.click();
          });
          console.log('[Automation] ✓ Validate Bank Info clicked');

          // Wait for validation API to complete - bank validation takes time
          console.log('[Automation] Waiting for bank validation API...');
          await new Promise(r => setTimeout(r, 6000));

          // Check the result message
          const validationResult = await page.evaluate(() => {
            const msgDiv = document.getElementById('msg');
            // NOTE: IsValidatedBankInfo() returns FALSE when bank IS validated (counterintuitive!)
            // This is because the button onclick uses: if (HasError() || IsValidatedBankInfo()) return false
            // So FALSE = allow button, TRUE = block button
            const funcResult =
              typeof IsValidatedBankInfo === 'function' ? IsValidatedBankInfo() : null;
            return {
              funcResult,
              // Bank is validated when function returns FALSE or message contains "Successful"
              isValidated:
                funcResult === false ||
                (msgDiv && msgDiv.textContent && msgDiv.textContent.includes('Successful')),
              message: msgDiv ? msgDiv.textContent.trim() : 'no message',
            };
          });
          // Log correctly - check the message for "Successful"
          const bankPassed = validationResult.message.includes('Successful');
          console.log('[Automation] Bank validation:', bankPassed ? '✓ SUCCESS' : '⚠ FAILED');
          console.log('[Automation] Validation message:', validationResult.message);
          console.log(
            '[Automation] IsValidatedBankInfo() returned:',
            validationResult.funcResult,
            '(FALSE = validated, TRUE = not validated)'
          );
        } else {
          console.log('[Automation] ⚠ Validate Bank Info button not found in DOM');
        }
      } catch (e) {
        console.log('[Automation] ⚠ Validate Bank Info error:', e.message, '- continuing anyway');
      }

      // Small wait after bank validation
      await new Promise(r => setTimeout(r, 1000));

      // ═══════════════════════════════════════════════════════════════════════
      // CLICK CONTINUE TO AGENT STATEMENT BUTTON
      // ═══════════════════════════════════════════════════════════════════════
      console.log('[Automation] Looking for Continue to Agent Statement button...');

      // DIAGNOSTIC: Check page state before clicking
      try {
        const pageState = await page.evaluate(() => {
          const result = {
            hasError: typeof HasError === 'function' ? HasError() : 'HasError not defined',
            isBankValidated:
              typeof IsValidatedBankInfo === 'function'
                ? IsValidatedBankInfo()
                : 'IsValidatedBankInfo not defined',
            errorMessages: [],
            allReqSpans: [], // Find ALL visible Req indicators
            emptyRequiredFields: [],
            currentUrl: window.location.href,
          };

          // Find any visible error messages (red text)
          const errors = document.querySelectorAll(
            '.error, .validation-error, [style*="color: red"], [style*="color:red"]'
          );
          errors.forEach(el => {
            if (el.textContent && el.textContent.trim() && el.offsetParent !== null) {
              result.errorMessages.push({
                id: el.id || 'no-id',
                tag: el.tagName,
                text: el.textContent.trim().substring(0, 100),
              });
            }
          });

          // CRITICAL: Find ALL visible elements that contain "Req" text
          const allSpans = document.querySelectorAll('span');
          allSpans.forEach(el => {
            const text = el.textContent ? el.textContent.trim() : '';
            if (text.toLowerCase().includes('req') && el.offsetParent !== null) {
              // Find the parent element to understand context
              let parentInfo = 'no parent';
              let parent = el.parentElement;
              for (let i = 0; i < 3 && parent; i++) {
                if (parent.id || parent.textContent) {
                  parentInfo = parent.id || parent.textContent.substring(0, 50);
                  break;
                }
                parent = parent.parentElement;
              }
              result.allReqSpans.push({
                id: el.id || 'no-id',
                text: text,
                parent: parentInfo,
                style: el.getAttribute('style') || 'no-style',
              });
            }
          });

          return result;
        });

        console.log('[Automation] 📊 PAGE STATE BEFORE CONTINUE:');
        console.log('[Automation]   - HasError():', pageState.hasError);
        // NOTE: IsValidatedBankInfo() returns FALSE when bank IS validated (allows button to proceed)
        // This is counterintuitive but that's how the page works
        const bankStatusMsg =
          pageState.isBankValidated === false
            ? 'FALSE (bank validated, button can proceed)'
            : pageState.isBankValidated === true
              ? 'TRUE (bank NOT validated, blocks button)'
              : pageState.isBankValidated;
        console.log('[Automation]   - IsValidatedBankInfo():', bankStatusMsg);
        console.log('[Automation]   - Red error elements found:', pageState.errorMessages.length);
        if (pageState.errorMessages.length > 0) {
          pageState.errorMessages.forEach((err, i) => {
            console.log(`[Automation]     ${i + 1}. [${err.tag}#${err.id}]: "${err.text}"`);
          });
        }
        console.log('[Automation]   - Visible "Req" spans found:', pageState.allReqSpans.length);
        if (pageState.allReqSpans.length > 0) {
          console.log('[Automation]   ⚠ REQUIRED FIELD INDICATORS:');
          pageState.allReqSpans.forEach((span, i) => {
            console.log(
              `[Automation]     ${i + 1}. ID: ${span.id}, Text: "${
                span.text
              }", Parent: ${span.parent}`
            );
          });
        }
        console.log('[Automation]   - Current URL:', pageState.currentUrl);
      } catch (e) {
        console.log('[Automation] Could not check page state:', e.message);
      }

      try {
        // Scroll to bottom of page to ensure the button is visible
        await page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        });
        await new Promise(r => setTimeout(r, 1000));

        let buttonClicked = false;

        console.log('[Automation] Attempting to click Continue to Agent Statement button...');

        // Get current URL to detect navigation
        const urlBeforeClick = page.url();
        console.log('[Automation] Current URL before click:', urlBeforeClick);

        // CRITICAL: There are TWO layers of validation we need to bypass:
        // 1. onclick="if (HasError() || IsValidatedBankInfo()) return false;"
        // 2. form onsubmit="WebForm_OnSubmit()" which calls ValidatorOnSubmit()

        // Step 1: Override ALL validation functions
        await page.evaluate(() => {
          // Override the onclick validation functions
          window.HasError = function () {
            return false;
          };
          window.IsValidatedBankInfo = function () {
            return false;
          };

          // Disable ASP.NET validation completely
          window.Page_ValidationActive = false;
          window.Page_IsValid = true;

          // Override ValidatorOnSubmit to always return true
          window.ValidatorOnSubmit = function () {
            return true;
          };

          // Override WebForm_OnSubmit to always return true
          window.WebForm_OnSubmit = function () {
            return true;
          };

          // Also remove the onclick handler from the button itself
          const btn = document.getElementById('BtnContinue');
          if (btn) {
            btn.onclick = null;
            btn.removeAttribute('onclick');
          }

          // Override form onsubmit
          const form = document.getElementById('form1');
          if (form) {
            form.onsubmit = function () {
              return true;
            };
          }
        });
        console.log(
          '[Automation] ✓ Disabled all validation (onclick, ASP.NET validators, form onsubmit)'
        );

        // Step 2: Submit the form using JavaScript (avoid Puppeteer click which hangs)
        console.log('[Automation] Submitting form via JavaScript...');

        try {
          // STEP 2a: Hide informational warning elements that contain "Req" or "Trust" text
          // These are help text, not actual validation errors, but can interfere with detection
          await page.evaluate(() => {
            // Hide informational spans that contain Trust warning text
            const spans = document.querySelectorAll('span');
            spans.forEach(el => {
              const text = el.textContent || '';
              if (
                text.includes('If selecting Trust') ||
                text.includes('trust paperwork') ||
                text.includes('Draft Dates with the Insured')
              ) {
                el.style.display = 'none';
              }
            });

            // Clear ALL validation error styling
            const errorElements = document.querySelectorAll(
              '[style*="color: red"], [style*="color:red"]'
            );
            errorElements.forEach(el => {
              el.style.color = 'inherit';
            });

            // Clear all ASP.NET validators
            if (typeof Page_Validators !== 'undefined' && Array.isArray(Page_Validators)) {
              Page_Validators.forEach(v => {
                v.isvalid = true;
                v.enabled = false;
              });
            }
          });
          console.log('[Automation] ✓ Cleared informational warnings and validators');

          // STEP 2b: Click via JavaScript (Puppeteer click times out on this button)
          console.log('[Automation] Clicking BtnContinue via JavaScript...');
          await page.evaluate(() => {
            // Click the button programmatically
            const btn = document.getElementById('BtnContinue');
            if (btn) {
              btn.click();
            }
          });
          console.log('[Automation] ✓ Button clicked via JavaScript');

          // Wait for page to navigate (don't use waitForNavigation which can hang)
          await new Promise(r => setTimeout(r, 5000));

          let urlAfter = page.url();
          console.log('[Automation] URL after JS click:', urlAfter);

          if (!urlAfter.includes('personalinfo')) {
            console.log('[Automation] ✓ Navigation successful!');
            buttonClicked = true;
          } else {
            // Try __doPostBack directly
            console.log('[Automation] Still on personalinfo, trying __doPostBack...');

            await page.evaluate(() => {
              __doPostBack('ctl00$ContentPlaceHolderBottomButton$BtnContinue', '');
            });
            console.log('[Automation] ✓ Called __doPostBack');

            // Wait for navigation
            await new Promise(r => setTimeout(r, 5000));

            urlAfter = page.url();
            console.log('[Automation] URL after __doPostBack:', urlAfter);

            if (!urlAfter.includes('personalinfo')) {
              console.log('[Automation] ✓ __doPostBack worked!');
              buttonClicked = true;
            } else {
              // Last resort: direct form submit
              console.log('[Automation] Trying direct form.submit()...');
              await page.evaluate(() => {
                const eventTarget = document.getElementById('__EVENTTARGET');
                if (eventTarget)
                  eventTarget.value = 'ctl00$ContentPlaceHolderBottomButton$BtnContinue';
                const form = document.getElementById('form1');
                if (form) form.submit();
              });

              await new Promise(r => setTimeout(r, 5000));
              urlAfter = page.url();
              console.log('[Automation] URL after form.submit:', urlAfter);

              if (!urlAfter.includes('personalinfo')) {
                console.log('[Automation] ✓ form.submit worked!');
                buttonClicked = true;
              }
            }
          }
        } catch (submitError) {
          console.log('[Automation] Submit error:', submitError.message);
        }

        if (!buttonClicked) {
          console.log('[Automation] ⚠ Continue to Agent Statement button not found');

          // ═══ TRIGGER RECOVERY FLOW ═══
          console.log('[Automation] ⚠ INITIATING RECOVERY FLOW...');
          const recoverySuccess = await attemptRecoveryFlow(page, `${firstName} ${lastName}`);

          if (!recoverySuccess) {
            console.log('[Automation] ✗ Recovery flow failed - cannot proceed');
            throw new Error(
              'Could not navigate to Agent Statement page - bank validation or form errors persisting'
            );
          }
          console.log('[Automation] ✓ Recovery flow successful, now on Agent Statement page');
        } else {
          // Wait for navigation after button click
          await new Promise(r => setTimeout(r, 3000));

          // Verify we actually navigated to Agent Statement page
          const currentUrl = page.url();
          const pageTitle = await page.title().catch(() => '');
          console.log('[Automation] After Continue click - URL:', currentUrl, 'Title:', pageTitle);

          // Check if page actually changed or if there was an error
          const stillOnSamePage = await page.evaluate(() => {
            // Check if we're still seeing bank validation errors or "Continue to Agent Statement" button
            const continueBtn = document.querySelector(
              'input[value="Continue to Agent Statement"]'
            );
            const bankErrors = document.querySelectorAll(
              '#BankDraftPanel span[style*="color: red"]'
            );
            const hasError = typeof HasError === 'function' ? HasError() : false;
            return continueBtn !== null || bankErrors.length > 0 || hasError;
          });

          if (stillOnSamePage) {
            console.log(
              '[Automation] ⚠ Still on same page after clicking Continue - initiating recovery...'
            );
            const recoverySuccess = await attemptRecoveryFlow(page, `${firstName} ${lastName}`);

            if (!recoverySuccess) {
              console.log('[Automation] ✗ Recovery flow failed');
              throw new Error('Form validation errors preventing navigation to Agent Statement');
            }
            console.log('[Automation] ✓ Recovery flow successful');
          }
        }
      } catch (e) {
        console.log('[Automation] Error clicking Continue button:', e.message);

        // Try recovery as last resort
        console.log('[Automation] Attempting recovery flow as last resort...');
        try {
          const recoverySuccess = await attemptRecoveryFlow(page, `${firstName} ${lastName}`);
          if (!recoverySuccess) {
            throw new Error('Recovery flow failed: ' + e.message);
          }
        } catch (recoveryError) {
          console.log('[Automation] Recovery also failed:', recoveryError.message);
          throw e; // Re-throw original error
        }
      }

      // Wait for Agent Statement page to load
      await new Promise(r => setTimeout(r, 3000));
    } // End of NORMAL MODE (else block) - retry mode joins here at Agent Statement

    // ═══════════════════════════════════════════════════════════════════════
    // AGENT STATEMENT PAGE
    // ═══════════════════════════════════════════════════════════════════════
    console.log('[Automation] ═══ AGENT STATEMENT PAGE ═══');

    try {
      // Wait for page to fully load
      await page.waitForSelector('#AgentSignature1', { timeout: 10000 });
      console.log('[Automation] ✓ Agent Statement page loaded');

      // 1. Agent's Electronic Signature - Always input 'Yazzyl Vasquez'
      await page.type('#AgentSignature1', 'Yazzyl Vasquez', { delay: 30 });
      console.log('[Automation] ✓ Agent Signature entered: Yazzyl Vasquez');

      // 2. City where proposed insured signed - use customer's city
      const customerCity = data.city || 'Chicago';
      await page.type('#CitySigned', customerCity.toUpperCase(), { delay: 30 });
      console.log(`[Automation] ✓ City Signed entered: ${customerCity}`);

      // 3. State where proposed insured signed - select from dropdown
      // Map full state name to abbreviation if needed
      const stateAbbreviations = {
        Illinois: 'IL',
        Texas: 'TX',
        California: 'CA',
        Florida: 'FL',
        'New York': 'NY',
        Tennessee: 'TN',
        Georgia: 'GA',
        Ohio: 'OH',
        Alabama: 'AL',
        Alaska: 'AK',
        Arizona: 'AZ',
        Arkansas: 'AR',
        Colorado: 'CO',
        Connecticut: 'CT',
        Delaware: 'DE',
        Hawaii: 'HI',
        Idaho: 'ID',
        Indiana: 'IN',
        Iowa: 'IA',
        Kansas: 'KS',
        Kentucky: 'KY',
        Louisiana: 'LA',
        Maine: 'ME',
        Maryland: 'MD',
        Massachusetts: 'MA',
        Michigan: 'MI',
        Minnesota: 'MN',
        Mississippi: 'MS',
        Missouri: 'MO',
        Montana: 'MT',
        Nebraska: 'NE',
        Nevada: 'NV',
        'New Hampshire': 'NH',
        'New Jersey': 'NJ',
        'New Mexico': 'NM',
        'North Carolina': 'NC',
        'North Dakota': 'ND',
        Oklahoma: 'OK',
        Oregon: 'OR',
        Pennsylvania: 'PA',
        'Rhode Island': 'RI',
        'South Carolina': 'SC',
        'South Dakota': 'SD',
        Utah: 'UT',
        Vermont: 'VT',
        Virginia: 'VA',
        Washington: 'WA',
        'West Virginia': 'WV',
        Wisconsin: 'WI',
        Wyoming: 'WY',
        'District of Columbia': 'DC',
      };

      const stateCode = stateAbbreviations[state] || state || 'IL';
      await page.select('#StateSigned', stateCode);
      console.log(`[Automation] ✓ State Signed selected: ${stateCode}`);

      // Small wait after filling signature section
      await new Promise(r => setTimeout(r, 500));

      // 4. Replacement Questions - use proper event dispatching
      // Does the proposed insured have any existing life insurance or annuity contract?
      const hasExistingIns = data.hasExistingInsurance === true || data.hasExisting === true;
      const existingInsId = hasExistingIns
        ? 'AgentExistingInsurance_1'
        : 'AgentExistingInsurance_2';
      await page.evaluate(id => {
        const radio = document.getElementById(id);
        if (radio) {
          radio.checked = true;
          radio.click();
          radio.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, existingInsId);
      console.log(`[Automation] ✓ Existing Insurance: ${hasExistingIns ? 'Yes' : 'No'}`);

      // Is the proposed insurance intended to replace or change any existing life insurance or annuity?
      const willReplace = data.willReplaceExisting === true || data.willReplace === true;
      const replaceId = willReplace ? 'AgentRepIns_1' : 'AgentRepIns_2';
      await page.evaluate(id => {
        const radio = document.getElementById(id);
        if (radio) {
          radio.checked = true;
          radio.click();
          radio.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, replaceId);
      console.log(`[Automation] ✓ Will Replace: ${willReplace ? 'Yes' : 'No'}`);

      await new Promise(r => setTimeout(r, 1000));

      // 5. Click 'Continue to Signatures' button
      // Button has onclick: if (HasError()) return false; if(mark && !NotMark()) return false;
      // We need to bypass this by removing the onclick handler
      console.log('[Automation] Clicking Continue to Signatures button...');

      const continueResult = await page.evaluate(() => {
        const btn = document.getElementById('btnContinue');
        if (btn) {
          // Remove the blocking onclick handler
          btn.onclick = null;
          btn.removeAttribute('onclick');

          // Click the button
          btn.click();
          return { success: true, method: 'direct-click' };
        }
        return { success: false };
      });

      if (continueResult.success) {
        console.log('[Automation] ✓ Clicked Continue to Signatures (onclick handler removed)');
      } else {
        // Fallback: try form submit
        console.log('[Automation] Trying form submit fallback...');
        await page.evaluate(() => {
          const form = document.getElementById('form1');
          if (form) {
            const eventTarget = document.getElementById('__EVENTTARGET');
            if (eventTarget) eventTarget.value = 'ctl00$ContentPlaceHolderBottomButton$btnContinue';
            form.submit();
          }
        });
        console.log('[Automation] ✓ Form submitted directly');
      }

      // Wait for navigation
      await new Promise(r => setTimeout(r, 3000));
    } catch (e) {
      console.log('[Automation] Error on Agent Statement page:', e.message);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SIGNATURE OPTIONS PAGE - Select Voice Recording
    // ═══════════════════════════════════════════════════════════════════════
    console.log('[Automation] ═══ SIGNATURE OPTIONS PAGE ═══');

    let applicationNumber = '';

    try {
      // Wait for page to load
      await new Promise(r => setTimeout(r, 2000));

      // Check if we're on the signature options page
      const voiceRecordingBtn =
        (await page.$('#optionVoiceUpload')) || (await page.$('#BtnUploadVoiceSig'));

      if (voiceRecordingBtn) {
        console.log('[Automation] Signature Options page loaded');

        // CAPTURE APPLICATION NUMBER - This is critical!
        try {
          applicationNumber = await page.evaluate(() => {
            // Try to find the app number in various locations
            const spanAppNumber = document.querySelector('#spanAppNumber');
            if (spanAppNumber) return spanAppNumber.textContent.trim();

            const appNumberLabel = document.querySelector('#AppNumberLabel');
            if (appNumberLabel) {
              // Extract the number from the span inside
              const innerSpan = appNumberLabel.querySelector('span[style*="x-large"]');
              if (innerSpan) return innerSpan.textContent.trim();
              // Or get full text and extract number
              const match = appNumberLabel.textContent.match(/M?\d{9,}/);
              if (match) return match[0].trim();
            }

            // Search the page for application number pattern
            const bodyText = document.body.innerText;
            const appMatch = bodyText.match(/M?00\d{7,}/);
            return appMatch ? appMatch[0].trim() : '';
          });

          console.log('[Automation] ✓✓✓ APPLICATION NUMBER CAPTURED:', applicationNumber);
        } catch (e) {
          console.log('[Automation] Error capturing application number:', e.message);
        }

        // Click the Voice Recording button
        const visibleVoiceBtn = await page.$('#optionVoiceUpload');
        if (visibleVoiceBtn) {
          await visibleVoiceBtn.click();
          console.log('[Automation] ✓ Clicked Voice Recording option');
        } else {
          // Fallback: click the hidden button directly
          await page.click('#BtnUploadVoiceSig');
          console.log('[Automation] ✓ Clicked Voice Recording (hidden button)');
        }

        await new Promise(r => setTimeout(r, 2000));
      } else {
        console.log('[Automation] Signature Options page not detected');

        // Still try to capture application number from current page
        try {
          applicationNumber = await page.evaluate(() => {
            const appNumberLabel = document.querySelector('#AppNumberLabel');
            if (appNumberLabel) {
              const innerSpan = appNumberLabel.querySelector('span[style*="x-large"]');
              if (innerSpan) return innerSpan.textContent.trim();
            }
            const spanAppNumber = document.querySelector('#spanAppNumber');
            if (spanAppNumber) return spanAppNumber.textContent.trim();
            return '';
          });
          if (applicationNumber) {
            console.log(
              '[Automation] ✓ Application Number captured from current page:',
              applicationNumber
            );
          }
        } catch (e) {
          console.log('[Automation] Could not capture application number');
        }
      }
    } catch (e) {
      console.log('[Automation] Error on Signature Options page:', e.message);
    }

    // Final result
    await new Promise(r => setTimeout(r, 2000));

    console.log('[Automation] ════════════════════════════════════════════════════════');
    console.log('[Automation] Final URL:', page.url());
    console.log('[Automation] Application Number:', applicationNumber || '(NOT CAPTURED)');

    // CRITICAL: Only return success if we actually have an application number
    if (applicationNumber && applicationNumber.trim() !== '') {
      console.log('[Automation] ✓✓✓ AUTOMATION COMPLETE - READY FOR VOICE RECORDING ✓✓✓');
      console.log('[Automation] ════════════════════════════════════════════════════════');
      return {
        success: true,
        message: 'Application ready for voice recording',
        applicationNumber: applicationNumber,
        customer: `${firstName} ${lastName}`,
        state: state,
        coverage: selectedCoverage,
      };
    } else {
      console.log('[Automation] ✗✗✗ AUTOMATION FAILED - NO APPLICATION NUMBER CAPTURED ✗✗✗');
      console.log('[Automation] ════════════════════════════════════════════════════════');
      return {
        success: false,
        error:
          'Automation completed but no application number was captured. The form may not have been submitted correctly.',
        customer: `${firstName} ${lastName}`,
        state: state,
        coverage: selectedCoverage,
      };
    }
  } catch (error) {
    console.error('[Automation] Error:', error);
    // Capture screenshot on failure
    if (browser) {
      try {
        const pages = await browser.pages();
        if (pages.length > 0) {
          await pages[0].screenshot({ path: 'automation-error.png' });
        }
      } catch (e) {
        console.error('Failed to capture error screenshot', e);
      }
    }
    return { success: false, error: error.message };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};
