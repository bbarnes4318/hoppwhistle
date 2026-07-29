/// <reference lib="dom" />
/**
 * American Amicable final-expense application RPA.
 *
 * Faithful TypeScript port of the working fe-rickie implementation
 * (fe-rickie/server/services/americanAmicable.js). Preserves the proven
 * 14-step sequence: agent login -> mobile portal -> new application ->
 * agent/product/state selection -> quote -> health questions -> personal &
 * banking -> bank validation -> agent statement -> signature -> capture
 * carrier application number -> voice-signature option.
 *
 * Credentials come exclusively from environment variables:
 *   AMERICAN_AMICABLE_AGENT_ID
 *   AMERICAN_AMICABLE_PASSWORD
 *   AMERICAN_AMICABLE_SIGNATURE_NAME
 * Optional:
 *   PUPPETEER_EXECUTABLE_PATH  (system Chromium in Docker/production)
 *   AUTOMATION_TEST_MODE       ('true' substitutes carrier-safe sample data)
 *
 * In NODE_ENV === 'test' no browser is ever launched — a mocked result is
 * returned immediately.
 */

/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unnecessary-type-assertion -- page.evaluate callbacks execute in the browser DOM context, which typed linting cannot resolve */

import type { Browser, Page } from 'puppeteer';

import { addJobStep, TOTAL_STEPS } from './job-store.js';
import type { NormalizedCarrierPayload } from './normalization.js';
import { captureDebugSnapshot } from './puppeteer-helpers.js';

export interface AutomationResult {
  success: boolean;
  message?: string;
  applicationNumber?: string;
  customer?: string;
  state?: string;
  coverage?: number;
  error?: string;
  debugSnapshotPath?: string | null;
}

// Base state mapping templates — the agent ID is appended at runtime
// (do NOT hardcode an agent ID into these codes).
const BASE_STATE_MAPPING: Record<string, string> = {
  Alaska: 'AASCAKSM001',
  Alabama: 'AASCALSM001',
  Arkansas: 'AASCARSM001',
  Arizona: 'AASCAZSM001',
  California: 'AASCCASM001',
  Colorado: 'AASCCOSM001',
  Connecticut: 'AASCCTSM001',
  'District of Columbia': 'AASCDCSM001',
  Delaware: 'AASCDESM001',
  Florida: 'AASCFLSM001',
  Georgia: 'AASCGASM001',
  Hawaii: 'AASCHISM001',
  Idaho: 'AASCIDSM001',
  Illinois: 'AASCILSM001',
  Indiana: 'AASCINSM001',
  Kansas: 'AASCKSSM001',
  Kentucky: 'AASCKYSM001',
  Louisiana: 'AASCLASM001',
  Maryland: 'AASCMDSM001',
  Maine: 'AASCMESM001',
  Minnesota: 'AASCMNSM001',
  Missouri: 'AASCMOSM001',
  Mississippi: 'AASCMSSM001',
  'North Carolina': 'AASCNCSM001',
  'North Dakota': 'AASCNDSM001',
  Nebraska: 'AASCNESM001',
  'New Mexico': 'AASCNMSM001',
  Nevada: 'AASCNVSM001',
  Ohio: 'AASCOHSM001',
  Oklahoma: 'AASCOKSM001',
  Oregon: 'AASCORSM001',
  Pennsylvania: 'AASCPASM001',
  'South Carolina': 'AASCSCSM001',
  'South Dakota': 'AASCSDSM001',
  Tennessee: 'AASCTNSM001',
  Texas: 'AASCTXSM001',
  Utah: 'AASCUTSM001',
  Virginia: 'AASCVASM001',
  Washington: 'AASCWASM001',
  Wisconsin: 'AASCWISM001',
  'West Virginia': 'AASCWVSM001',
  Wyoming: 'AASCWYSM001',
};

const STATE_ABBREVIATIONS: Record<string, string> = {
  Illinois: 'IL',
  Texas: 'TX',
  California: 'CA',
  Florida: 'FL',
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

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

const log = (message: string): void => {
  console.log(`[CarrierRPA] ${message}`);
};

/**
 * Launch a Chromium browser instance with production-safe options.
 */
export const launchBrowser = async (
  jobId: string | null
): Promise<{ browser: Browser; page: Page }> => {
  addJobStep(jobId, 1, TOTAL_STEPS, 'in_progress', 'Launching browser...');
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
  log(`Puppeteer executable path: ${executablePath || 'bundled Chrome'}`);

  const puppeteer = (await import('puppeteer')).default;
  const browser = await puppeteer.launch({
    headless: 'new' as never,
    executablePath,
    protocolTimeout: 300000,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--single-process',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  addJobStep(jobId, 1, TOTAL_STEPS, 'in_progress', 'Browser launched');
  return { browser, page };
};

/**
 * Authenticate with the American Amicable primary agent site.
 */
export const loginToAmericanAmicable = async (
  page: Page,
  agentId: string,
  password: string,
  jobId: string | null
): Promise<void> => {
  addJobStep(jobId, 2, TOTAL_STEPS, 'in_progress', 'Logging into carrier portal...');
  log('Navigating to Agent Login...');
  await page.goto('https://www.americanamicable.com/v4/AgentLogin.php', {
    waitUntil: 'networkidle0',
  });

  await page.waitForSelector('#user');
  await page.type('#user', agentId);
  await page.type('#password', password);

  await Promise.all([
    page.click('input[type="submit"][value="Submit"]'),
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
  ]);

  log('Clicking Continue...');
  try {
    await page.waitForSelector('img[src="images/continue.png"]', { timeout: 5000 });
    await Promise.all([
      page.click('img[src="images/continue.png"]'),
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
    ]);
  } catch {
    log('Continue image not found, checking for link...');
    await page.waitForSelector('a[href*="/Marketing/area/A"]');
    await Promise.all([
      page.click('a[href*="/Marketing/area/A"]'),
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
    ]);
  }
  addJobStep(jobId, 2, TOTAL_STEPS, 'in_progress', 'Successfully logged in');
};

/**
 * Switch context and navigate to the mobile insurance portal.
 */
export const navigateToMobilePortal = async (
  page: Page,
  agentId: string,
  password: string,
  jobId: string | null
): Promise<Page> => {
  addJobStep(jobId, 3, TOTAL_STEPS, 'in_progress', 'Accessing mobile application portal...');
  await sleep(2000);

  const mobileLinkSelector = 'a[href="https://www.insuranceapplication.com/"]';
  const mobileLinkAlt = 'a[href*="insuranceapplication.com"]';
  let foundMobileLink = false;

  try {
    await page.waitForSelector(mobileLinkSelector, { timeout: 10000 });
    foundMobileLink = true;
  } catch {
    try {
      await page.waitForSelector(mobileLinkAlt, { timeout: 5000 });
      foundMobileLink = true;
    } catch {
      log('No mobile link found on page');
    }
  }

  const browser = page.browser();
  let activePage = page;

  if (foundMobileLink) {
    const newPagePromise = new Promise<Page>(resolve => {
      browser.once('targetcreated', target => {
        void target.page().then(newP => {
          if (newP) resolve(newP);
        });
      });
    });

    await page.click(mobileLinkSelector).catch(() => page.click(mobileLinkAlt));

    try {
      const newPage = await Promise.race([
        newPagePromise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000)),
      ]);
      log('✓ New tab opened');
      activePage = newPage;
      await activePage.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {});
    } catch {
      log('No new tab opened, navigating directly...');
      await activePage.goto('https://www.insuranceapplication.com/', {
        waitUntil: 'networkidle0',
        timeout: 60000,
      });
    }
  } else {
    await activePage.goto('https://www.insuranceapplication.com/', {
      waitUntil: 'networkidle0',
      timeout: 60000,
    });
  }

  await sleep(2000);

  const loginFormExists = await activePage.$('#LoginId').catch(() => null);
  if (loginFormExists) {
    log('Login form detected, performing mobile login...');
    await activePage.type('#LoginId', agentId);
    await activePage.type('#Password', password);
    await activePage.click('#LoginBtn').catch(() => activePage.click('input[type="submit"]'));
    await activePage.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {});
    await sleep(2000);
  }

  try {
    const appLinks = await activePage.$$eval('a[href*="cgi/webappmobile"]', els =>
      els
        .filter(
          a =>
            !a.href.includes('.pdf') && !a.href.includes('DocHandler') && !a.href.includes('Demo')
        )
        .map(a => a.href)
    );
    if (appLinks.length > 0) {
      await activePage.goto(appLinks[0], { waitUntil: 'networkidle0', timeout: 30000 });
    } else {
      const mobileAppSelector = 'a[href="https://www.insuranceapplication.com/cgi/webappmobile/"]';
      await Promise.all([
        activePage.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }),
        activePage.click(mobileAppSelector),
      ]);
    }
  } catch {
    await activePage.goto('https://www.insuranceapplication.com/cgi/webappmobile/', {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });
  }

  log('Mobile Login stage 2...');
  await activePage.waitForSelector('#LoginId');
  await activePage.type('#LoginId', agentId);
  await activePage.type('#Password', password);

  await Promise.all([
    activePage.click('#LoginBtn'),
    activePage.waitForNavigation({ waitUntil: 'networkidle0' }),
  ]);

  addJobStep(jobId, 3, TOTAL_STEPS, 'in_progress', 'Accessed mobile application portal');
  return activePage;
};

/**
 * Click option to create a new application.
 */
export const startNewApplication = async (page: Page, jobId: string | null): Promise<void> => {
  addJobStep(jobId, 4, TOTAL_STEPS, 'in_progress', 'Starting new application...');
  await page.waitForSelector('#BtnNewApp', { timeout: 15000 });
  await page.click('#BtnNewApp');
  await sleep(2000);
  addJobStep(jobId, 4, TOTAL_STEPS, 'in_progress', 'Started new application');
};

/**
 * Select the appropriate agent from the grid (matched dynamically by agent ID).
 */
export const selectAgent = async (
  page: Page,
  agentId: string,
  jobId: string | null
): Promise<void> => {
  addJobStep(jobId, 5, TOTAL_STEPS, 'in_progress', 'Selecting agent...');
  await page.waitForSelector('td.dataItem', { timeout: 15000 });
  const agentCells = await page.$$('td.dataItem');

  let agentFound = false;
  for (const cell of agentCells) {
    const text = await page.evaluate(e => e.textContent, cell);
    if (text && text.includes(agentId)) {
      await cell.click({ clickCount: 2 });
      agentFound = true;
      break;
    }
  }

  if (!agentFound) {
    throw new Error(`Could not find agent ${agentId} in grid`);
  }

  await sleep(2000);
  addJobStep(jobId, 5, TOTAL_STEPS, 'in_progress', 'Agent selected');
};

/**
 * Select Senior Choice Final Expense product from the carrier popup menu.
 */
export const selectProduct = async (page: Page, jobId: string | null): Promise<void> => {
  addJobStep(jobId, 6, TOTAL_STEPS, 'in_progress', 'Selecting product...');
  await page.waitForSelector('#ProductMenu', { visible: true, timeout: 10000 }).catch(() => {});

  const productResult = await page.evaluate(() => {
    const productMenu = document.getElementById('ProductMenu');
    let container: Element | null = productMenu;
    if (!container || (container as HTMLElement).style.display === 'none') {
      const modals = document.querySelectorAll('[id*="Menu"], [id*="Popup"], [class*="modal"]');
      for (const modal of Array.from(modals)) {
        if (
          (modal as HTMLElement).offsetParent !== null &&
          modal.querySelectorAll('td.dataItem').length > 0
        ) {
          container = modal;
          break;
        }
      }
    }

    if (!container) {
      const allCells = document.querySelectorAll('td.dataItem');
      for (const cell of Array.from(allCells)) {
        if (cell.textContent && cell.textContent.includes('Senior Choice (FE 50-85)')) {
          const row = cell.closest('tr');
          if (row && row.classList.contains('dataRow') && (row as HTMLElement).onclick) continue;
          const hiddenLinks = row?.querySelectorAll(
            'a[href*="__doPostBack"], a[href*="javascript:"]'
          );
          if (hiddenLinks && hiddenLinks.length > 0) {
            (hiddenLinks[0] as HTMLElement).click();
            return { success: true };
          }
          const dblClickEvent = new MouseEvent('dblclick', {
            bubbles: true,
            cancelable: true,
            view: window,
          });
          (row || cell).dispatchEvent(dblClickEvent);
          return { success: true };
        }
      }
      return { success: false };
    }

    const cells = container.querySelectorAll('td.dataItem');
    for (const cell of Array.from(cells)) {
      if (
        cell.textContent &&
        (cell.textContent.includes('Senior Choice (FE 50-85)') ||
          cell.textContent.includes('Senior Choice'))
      ) {
        const row = cell.closest('tr');
        const hiddenLinks = row?.querySelectorAll(
          'a[href*="__doPostBack"], a[href*="javascript:"]'
        );
        if (hiddenLinks && hiddenLinks.length > 0) {
          (hiddenLinks[0] as HTMLElement).click();
          return { success: true };
        }
        if (row && (row as HTMLElement).onclick) {
          ((row as HTMLElement).onclick as unknown as () => void)();
          return { success: true };
        }
        const dblClickEvent = new MouseEvent('dblclick', {
          bubbles: true,
          cancelable: true,
          view: window,
        });
        (row || cell).dispatchEvent(dblClickEvent);
        return { success: true };
      }
    }
    return { success: false };
  });

  if (!productResult.success) {
    throw new Error('Could not find Senior Choice product in popup');
  }

  await sleep(3000);
  addJobStep(jobId, 6, TOTAL_STEPS, 'in_progress', 'Product selected');
};

/**
 * Select the state for this application.
 * Uses the base state template plus the runtime agent ID.
 */
export const selectState = async (
  page: Page,
  state: string,
  agentId: string,
  jobId: string | null
): Promise<void> => {
  addJobStep(jobId, 7, TOTAL_STEPS, 'in_progress', 'Selecting state...');
  await page.waitForSelector('#StateMenu', { timeout: 10000 });

  const stateTemplate = BASE_STATE_MAPPING[state];
  if (!stateTemplate) {
    throw new Error(`State "${state}" not found in BASE_STATE_MAPPING`);
  }
  const stateCode = `${stateTemplate}${agentId}`;

  await page.click('#StateDropDown');
  await sleep(500);

  try {
    await page.select('#StateDropDown', stateCode);
  } catch {
    const optionClicked = await page.evaluate(
      (targetValue, targetState) => {
        const select = document.querySelector('#StateDropDown') as HTMLSelectElement | null;
        if (!select) return false;
        for (const opt of Array.from(select.options)) {
          if (opt.value === targetValue || opt.text.includes(targetState)) {
            opt.selected = true;
            select.value = opt.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        }
        return false;
      },
      stateCode,
      state
    );

    if (!optionClicked) {
      throw new Error(`Could not select state "${state}"`);
    }
  }

  await sleep(500);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {}),
    page.click('#BtnNewAppFinal'),
  ]);

  await sleep(3000);
  addJobStep(jobId, 7, TOTAL_STEPS, 'in_progress', 'State selected');
};

/**
 * Complete the initial policy quotation parameters.
 */
export const fillQuoteForm = async (
  page: Page,
  data: NormalizedCarrierPayload,
  jobId: string | null
): Promise<void> => {
  addJobStep(jobId, 8, TOTAL_STEPS, 'in_progress', 'Filling quote form...');
  await page.waitForSelector('#InsNameFirst', { timeout: 15000 });

  await page.type('#InsNameFirst', data.firstName.toUpperCase());
  if (data.middleName) {
    await page.type('#InsNameMiddle', data.middleName.toUpperCase());
  }
  await page.type('#InsNameLast', data.lastName.toUpperCase());
  await page.type('#dob', data.dob);

  if (data.age) {
    await page.type('#dobAge', String(data.age));
  }

  const genderValue = data.gender === 'Male' ? 'M' : 'F';
  await page.click(`input[name="ctl00$ContentPlaceHolderMain$Sex"][value="${genderValue}"]`);

  const tobaccoValue = data.tobacco ? 'T' : 'N';
  await page.click(`input[name="ctl00$ContentPlaceHolderMain$Tobacco"][value="${tobaccoValue}"]`);

  await page.click('#Acceptance');

  // Plan Type mapping
  let planValue = 'I';
  if (data.selectedPlanType === 'Graded') planValue = 'G';
  else if (data.selectedPlanType === 'ROP') planValue = 'R';

  await page.click(`input[name="ctl00$ContentPlaceHolderMain$Plan"][value="${planValue}"]`);
  await page.select('#Mode', 'M');

  const coverageAmount = String(data.selectedCoverage || 10000);
  await page.type('#Coverage', coverageAmount);

  await page.click('#APL_1');
  await page.click('#MailTo_1');

  const today = new Date();
  const policyDate = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(
    today.getDate()
  ).padStart(2, '0')}/${today.getFullYear()}`;
  await page.type('#ReqPolicyDate', policyDate);

  try {
    const digitalSection = await page.$('#DigitalInterestQ_1');
    if (digitalSection) {
      const isVisible = await page.evaluate(
        el => (el as HTMLElement).offsetParent !== null,
        digitalSection
      );
      if (isVisible) {
        await page.click('#DigitalInterestQ_1');
      }
    }
  } catch {
    // Optional section
  }

  await page.click('#BtnQuote');
  await sleep(5000);

  try {
    await page.waitForSelector('#BtnContinue', { timeout: 15000 });
    await page.click('#BtnContinue');
  } catch {
    log('Continue button not found, continuing...');
  }

  await sleep(3000);
  addJobStep(jobId, 8, TOTAL_STEPS, 'in_progress', 'Quote form filled');
};

/**
 * Answer applicant health questions.
 */
export const fillHealthQuestions = async (
  page: Page,
  data: NormalizedCarrierPayload,
  jobId: string | null
): Promise<void> => {
  addJobStep(jobId, 9, TOTAL_STEPS, 'in_progress', 'Filling health questions...');

  const answerHealthQuestion = async (questionId: string, answer: boolean): Promise<void> => {
    const suffix = answer ? '_1' : '_2';
    const selector = `#${questionId}${suffix}`;
    try {
      await page.waitForSelector(selector, { timeout: 5000 });
      await page.click(selector);
    } catch {
      log(`Health question ${questionId} not found`);
    }
  };

  await answerHealthQuestion('_SectionA1', data.healthQ1);
  await answerHealthQuestion('_SectionA2', data.healthQ2);
  await answerHealthQuestion('_SectionA3', data.healthQ3);
  await answerHealthQuestion('_SectionA4', data.healthQ4);
  await answerHealthQuestion('_SectionA5', data.healthQ5);
  await answerHealthQuestion('_SectionA6', data.healthQ6);
  await answerHealthQuestion('_SectionA7a', data.healthQ7a);
  await answerHealthQuestion('_SectionA7b', data.healthQ7b);
  await answerHealthQuestion('_SectionA7c', data.healthQ7c);
  await answerHealthQuestion('_SectionA7d', data.healthQ7d);
  await answerHealthQuestion('_SectionA8a', data.healthQ8a);
  await answerHealthQuestion('_SectionA8b', data.healthQ8b);
  await answerHealthQuestion('_SectionA8c', data.healthQ8c);
  await answerHealthQuestion('CVQ1', data.healthCovid);

  try {
    await page.waitForSelector('#BtnContinue', { timeout: 10000 });
    await page.click('#BtnContinue');
  } catch {
    log('Continue button not found after health questions');
  }

  await sleep(2000);
  addJobStep(jobId, 9, TOTAL_STEPS, 'in_progress', 'Health questions filled');
};

/**
 * Complete the personal details, beneficiary, owner/payor, existing insurance,
 * doctor, SSN, email, phone, height/weight, and banking fields.
 */
export const fillPersonalAndBanking = async (
  page: Page,
  data: NormalizedCarrierPayload,
  jobId: string | null
): Promise<void> => {
  addJobStep(jobId, 10, TOTAL_STEPS, 'in_progress', 'Filling personal and banking information...');
  await page.waitForSelector('#Method', { timeout: 15000 }).catch(() => {});

  try {
    await page.evaluate(() => {
      const radio = document.getElementById('Method_1') as HTMLInputElement | null;
      if (radio) {
        radio.checked = true;
        radio.click();
        radio.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await sleep(2000);
  } catch {
    // Payment method radio not present
  }

  const clearAndTypeIfPresent = async (selector: string, value: string): Promise<void> => {
    try {
      const field = await page.$(selector);
      if (field) {
        await field.click({ clickCount: 3 });
        await page.type(selector, value);
      }
    } catch {
      // Field not present on this form variant
    }
  };

  await clearAndTypeIfPresent('#AccountHolder', data.accountHolder.toUpperCase());
  await clearAndTypeIfPresent('#BankName', data.bankName.toUpperCase());
  await clearAndTypeIfPresent('#BankAddress', data.bankCityState.toUpperCase());

  try {
    const sspId = data.ssPaymentSchedule ? '#SSP_1' : '#SSP_2';
    await page.waitForSelector(sspId, { timeout: 5000 });
    await page.click(sspId);
    await sleep(3000);

    await page.select('#RequestedDraftDay', String(data.draftDay));
  } catch (e) {
    log(`SS Payment selection error: ${(e as Error).message}`);
  }

  await clearAndTypeIfPresent('#TransitNumber', data.routingNumber);
  await clearAndTypeIfPresent('#AccountNumber', data.accountNumber);

  try {
    const typeId = data.accountType === 'Saving' ? '#AcctType_2' : '#AcctType_1';
    await page.click(typeId);
  } catch {
    // Account type radio not present
  }

  if (data.ssn) {
    await clearAndTypeIfPresent('#SSN', data.ssn);
  }
  await clearAndTypeIfPresent('#Email', data.email);
  await clearAndTypeIfPresent('#Phone', data.phone);

  try {
    await page.select('#StateOfBirth', data.birthState);
  } catch {
    // State of birth dropdown not present
  }

  try {
    await page.select('#HeightFt', String(data.heightFeet));
    await page.select('#HeightIn', String(data.heightInches));
    await clearAndTypeIfPresent('#Weight', String(data.weight));
  } catch {
    // Height/weight fields not present
  }

  try {
    await clearAndTypeIfPresent('#BenName', data.beneficiaryName.toUpperCase());
    await page.select('#BenRelation', data.beneficiaryRelation);
  } catch {
    // Beneficiary fields not present
  }

  try {
    await clearAndTypeIfPresent('#DoctorName', data.doctorName.toUpperCase());
    await clearAndTypeIfPresent('#DoctorAddress', data.doctorAddress.toUpperCase());
    await clearAndTypeIfPresent('#DoctorPhone', data.doctorPhone);
  } catch {
    // Doctor fields not present
  }

  try {
    const ownerId = data.ownerIsInsured ? '#OwnerQ_1' : '#OwnerQ_2';
    await page.click(ownerId);
  } catch {
    // Owner radio not present
  }

  try {
    const payorId = data.payorIsInsured
      ? '#ctl00_ContentPlaceHolderMain_PayorQ_0'
      : '#ctl00_ContentPlaceHolderMain_PayorQ_1';
    await page.click(payorId);
  } catch {
    // Payor radio not present
  }

  try {
    const existingId = data.hasExistingInsurance ? '#InsQ1_1' : '#InsQ1_2';
    await page.click(existingId);
    await sleep(1000);

    if (data.hasExistingInsurance) {
      await page.type('#ctl00_ContentPlaceHolderMain_Company1', data.existingCompanyName || 'None');
      await page.type(
        '#ctl00_ContentPlaceHolderMain_PolicyNo1',
        data.existingPolicyNumber || 'None'
      );
      await page.type(
        '#ctl00_ContentPlaceHolderMain_Amount1',
        String(data.existingCoverageAmount || '10000')
      );
    }
  } catch {
    // Existing insurance section not present
  }

  try {
    const replaceId = data.willReplaceExisting ? '#InsQ2_1' : '#InsQ2_2';
    await page.click(replaceId);
  } catch {
    // Replacement radio not present
  }

  if (data.state === 'Illinois' && data.ilDesigneeChoice) {
    try {
      const designeeId = data.ilDesigneeChoice === 'Will Designate' ? '#SSP_0' : '#SSP_1';
      await page.click(designeeId);
    } catch {
      // IL designee radio not present
    }
  }

  await sleep(1000);
  addJobStep(jobId, 10, TOTAL_STEPS, 'in_progress', 'Personal and banking info filled');
};

/**
 * Click validate bank button and wait for completion message.
 */
export const validateBankInfo = async (page: Page, jobId: string | null): Promise<void> => {
  addJobStep(jobId, 11, TOTAL_STEPS, 'in_progress', 'Validating bank information...');
  try {
    await page.evaluate(() => {
      const validateDiv = document.getElementById('dvValidateBankInfo');
      if (validateDiv) validateDiv.style.display = 'block';
    });
    await sleep(500);

    await page.evaluate(() => {
      const bankBtn = document.getElementById('btValidateBankInfo');
      if (bankBtn)
        bankBtn.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'center' });
    });
    await sleep(500);

    const btnExists = await page.$('#btValidateBankInfo');
    if (btnExists) {
      await page.evaluate(() => {
        const btn = document.getElementById('btValidateBankInfo');
        if (btn) btn.click();
      });
      log('✓ Validate Bank Info clicked');
      await sleep(6000);

      const validationResult = await page.evaluate(() => {
        const msgDiv = document.getElementById('msg');
        const fn = (window as unknown as Record<string, unknown>).IsValidatedBankInfo;
        const funcResult = typeof fn === 'function' ? (fn as () => unknown)() : null;
        return {
          funcResult,
          isValidated:
            funcResult === false ||
            Boolean(msgDiv && msgDiv.textContent && msgDiv.textContent.includes('Successful')),
          message: msgDiv && msgDiv.textContent ? msgDiv.textContent.trim() : 'no message',
        };
      });

      const bankPassed = validationResult.message.includes('Successful');
      log(`Bank validation status: ${bankPassed ? '✓ SUCCESS' : '⚠ FAILED'}`);
    }
  } catch (e) {
    log(`⚠ Validate Bank Info error: ${(e as Error).message}`);
  }
  addJobStep(jobId, 11, TOTAL_STEPS, 'in_progress', 'Bank information validation completed');
};

/**
 * Scrape validation errors from the carrier page DOM.
 */
export const captureCarrierValidationErrors = async (page: Page): Promise<string[]> => {
  return await page.evaluate(() => {
    const errorMessages: string[] = [];
    const errors = document.querySelectorAll(
      '.error, .validation-error, [style*="color: red"], [style*="color:red"]'
    );
    errors.forEach(el => {
      if (el.textContent && el.textContent.trim() && (el as HTMLElement).offsetParent !== null) {
        const text = el.textContent.trim();
        if (text && !text.toLowerCase().includes('req') && !errorMessages.includes(text)) {
          errorMessages.push(text);
        }
      }
    });
    return errorMessages;
  });
};

/**
 * Submit the banking page, checking for validator blocks.
 */
export const continueToAgentStatement = async (
  page: Page,
  data: NormalizedCarrierPayload,
  jobId: string | null
): Promise<void> => {
  addJobStep(jobId, 12, TOTAL_STEPS, 'in_progress', 'Continuing to Agent Statement page...');

  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });
  await sleep(1000);

  log('Clicking BtnContinue without validation overrides...');
  const normalClickResult = await page.evaluate(() => {
    const btn = document.getElementById('BtnContinue');
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });

  if (normalClickResult) {
    await sleep(5000);
  }

  const urlAfter = page.url();
  log(`URL after normal click check: ${urlAfter}`);

  if (urlAfter.includes('personalinfo')) {
    const errors = await captureCarrierValidationErrors(page);
    if (errors.length > 0) {
      log(`Validation errors blocking submission: ${errors.join('; ')}`);
      const snapshotPath = await captureDebugSnapshot(page, 'carrier_validation_error');
      throw new Error(
        `Carrier validation blocked form submission: ${errors.join('; ')}. Snapshot path: ${snapshotPath || 'none'}`
      );
    }

    log('⚠ Navigation did not occur. Attempting recovery flow...');
    const recoverySuccess = await attemptRecoveryFlow(page, `${data.firstName} ${data.lastName}`);
    if (!recoverySuccess) {
      throw new Error('Could not navigate to Agent Statement page - form submission failed');
    }
  }

  addJobStep(jobId, 12, TOTAL_STEPS, 'in_progress', 'Navigated to Agent Statement page');
};

/**
 * Override browser validations as a last-resort recovery path.
 */
export const attemptRecoveryFlow = async (page: Page, customerName: string): Promise<boolean> => {
  log('▶▶▶ STARTING RECOVERY FLOW (LAST RESORT) ◀◀◀');
  try {
    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      w.HasError = () => false;
      w.IsValidatedBankInfo = () => false;
      w.Page_ValidationActive = false;
      w.Page_IsValid = true;
      w.ValidatorOnSubmit = () => true;
      w.WebForm_OnSubmit = () => true;

      const btn = document.getElementById('BtnContinue');
      if (btn) {
        btn.onclick = null;
        btn.removeAttribute('onclick');
      }

      const form = document.getElementById('form1') as HTMLFormElement | null;
      if (form) form.onsubmit = () => true;
    });

    log('Saving and returning to applications...');
    const saveClicked = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input[type="submit"]');
      for (const inp of Array.from(inputs) as HTMLInputElement[]) {
        if (inp.value && inp.value.toLowerCase().includes('save')) {
          inp.click();
          return true;
        }
      }
      return false;
    });

    if (!saveClicked) return false;

    await sleep(5000);
    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {});

    const appFound = await page.evaluate(name => {
      const rows = document.querySelectorAll('table tr, .application-row');
      for (const row of Array.from(rows)) {
        if (row.textContent && row.textContent.includes(name.split(' ')[0])) {
          const link = row.querySelector('a') || row.querySelector('input[type="button"]');
          if (link) {
            link.click();
            return true;
          }
        }
      }
      return false;
    }, customerName);

    if (!appFound) return false;

    await sleep(5000);

    await page.evaluate(() => {
      const editBtn = document.querySelector('input[value="Edit"]') as HTMLElement | null;
      if (editBtn) editBtn.click();
    });
    await sleep(3000);

    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      const quoteBtn = document.querySelector('input[value="Quote"]') as HTMLElement | null;
      if (quoteBtn) quoteBtn.click();
    });
    await sleep(5000);

    await page.evaluate(() => {
      const contBtn = document.querySelector(
        'input[value="Continue Application"]'
      ) as HTMLElement | null;
      if (contBtn) contBtn.click();
    });
    await sleep(5000);

    await page.evaluate(() => {
      const contBtn = document.querySelector(
        'input[value="Continue to Agent Statement"]'
      ) as HTMLElement | null;
      if (contBtn) contBtn.click();
    });
    await sleep(5000);

    return !page.url().includes('personalinfo');
  } catch (e) {
    log(`Exception inside recovery flow: ${(e as Error).message}`);
    return false;
  }
};

/**
 * Complete replacement details and sign the agent statement page.
 */
export const completeAgentStatement = async (
  page: Page,
  data: NormalizedCarrierPayload,
  jobId: string | null
): Promise<void> => {
  addJobStep(jobId, 13, TOTAL_STEPS, 'in_progress', 'Completing Agent Statement page...');
  await page.waitForSelector('#AgentSignature1', { timeout: 15000 });

  const signatureName = process.env.AMERICAN_AMICABLE_SIGNATURE_NAME;
  if (!signatureName) {
    throw new Error('AMERICAN_AMICABLE_SIGNATURE_NAME environment variable is missing');
  }
  await page.type('#AgentSignature1', signatureName, { delay: 30 });

  const customerCity = data.city || 'Chicago';
  await page.type('#CitySigned', customerCity.toUpperCase(), { delay: 30 });

  const stateCode = STATE_ABBREVIATIONS[data.state] || data.state || 'IL';
  await page.select('#StateSigned', stateCode);

  const existingInsId = data.hasExistingInsurance
    ? 'AgentExistingInsurance_1'
    : 'AgentExistingInsurance_2';
  await page.evaluate(id => {
    const radio = document.getElementById(id) as HTMLInputElement | null;
    if (radio) {
      radio.checked = true;
      radio.click();
    }
  }, existingInsId);

  const replaceId = data.willReplaceExisting ? 'AgentRepIns_1' : 'AgentRepIns_2';
  await page.evaluate(id => {
    const radio = document.getElementById(id) as HTMLInputElement | null;
    if (radio) {
      radio.checked = true;
      radio.click();
    }
  }, replaceId);

  await sleep(1000);

  log('Clicking Continue to Signatures...');
  const clicked = await page.evaluate(() => {
    const btn = document.getElementById('btnContinue');
    if (btn) {
      btn.onclick = null;
      btn.removeAttribute('onclick');
      btn.click();
      return true;
    }
    return false;
  });

  if (!clicked) {
    await page.evaluate(() => {
      const form = document.getElementById('form1') as HTMLFormElement | null;
      if (form) {
        const eventTarget = document.getElementById('__EVENTTARGET') as HTMLInputElement | null;
        if (eventTarget) eventTarget.value = 'ctl00$ContentPlaceHolderBottomButton$btnContinue';
        form.submit();
      }
    });
  }

  await sleep(5000);
  addJobStep(jobId, 13, TOTAL_STEPS, 'in_progress', 'Completed Agent Statement page');
};

/**
 * Capture the carrier application number and select the voice recording /
 * voice signature upload option.
 */
export const selectVoiceRecordingAndCaptureApplicationNumber = async (
  page: Page,
  jobId: string | null
): Promise<string> => {
  addJobStep(jobId, 14, TOTAL_STEPS, 'in_progress', 'Capturing carrier application number...');
  await sleep(2000);

  const applicationNumber = await page.evaluate(() => {
    const spanAppNumber = document.querySelector('#spanAppNumber');
    if (spanAppNumber && spanAppNumber.textContent) return spanAppNumber.textContent.trim();

    const appNumberLabel = document.querySelector('#AppNumberLabel');
    if (appNumberLabel) {
      const innerSpan = appNumberLabel.querySelector('span[style*="x-large"]');
      if (innerSpan && innerSpan.textContent) return innerSpan.textContent.trim();
      const match = appNumberLabel.textContent
        ? appNumberLabel.textContent.match(/M?\d{9,}/)
        : null;
      if (match) return match[0].trim();
    }

    const bodyText = document.body.innerText;
    const appMatch = bodyText.match(/M?00\d{7,}/);
    return appMatch ? appMatch[0].trim() : '';
  });

  if (applicationNumber) {
    log(`✓✓✓ APPLICATION NUMBER CAPTURED: ${applicationNumber}`);
  }

  try {
    const voiceRecordingBtn =
      (await page.$('#optionVoiceUpload')) || (await page.$('#BtnUploadVoiceSig'));
    if (voiceRecordingBtn) {
      const visibleVoiceBtn = await page.$('#optionVoiceUpload');
      if (visibleVoiceBtn) {
        await visibleVoiceBtn.click();
      } else {
        await page.click('#BtnUploadVoiceSig');
      }
      await sleep(2000);
    }
  } catch (e) {
    log(`Error clicking voice recording option: ${(e as Error).message}`);
  }

  if (!applicationNumber || applicationNumber.trim() === '') {
    throw new Error('RPA completed but no application number was captured');
  }

  addJobStep(
    jobId,
    14,
    TOTAL_STEPS,
    'completed',
    `Completed: Application Number captured: ${applicationNumber}`
  );
  return applicationNumber;
};

/**
 * Carrier-safe sample data used ONLY when AUTOMATION_TEST_MODE=true is set
 * explicitly in the environment (never on by default).
 */
const buildTestModeData = (data: NormalizedCarrierPayload): NormalizedCarrierPayload => ({
  ...data,
  firstName: 'Sarah',
  middleName: 'Robert',
  lastName: 'Williams',
  state: 'Illinois',
  dob: '05/15/1970',
  age: 55,
  gender: 'Male',
  tobacco: false,
  selectedCoverage: 10000,
  selectedPlanType: 'Level',
  address: '123 Main Street',
  city: 'Chicago',
  zip: '60601',
  ssn: '412741242',
  phone: '5551234567',
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
  doctorName: 'Dan Johns',
  doctorAddress: '123 Dan Dr Chicago, IL 60606',
  doctorPhone: '3145671212',
  ownerIsInsured: true,
  payorIsInsured: true,
  hasExistingInsurance: false,
  willReplaceExisting: false,
});

/**
 * Public exported RPA submission routine.
 */
export const runAmericanAmicableAutomation = async (
  inputData: NormalizedCarrierPayload,
  jobId: string | null = null
): Promise<AutomationResult> => {
  // In the test environment, never launch a browser or contact the carrier.
  if (process.env.NODE_ENV === 'test') {
    addJobStep(jobId, 1, TOTAL_STEPS, 'in_progress', 'Launching browser...');
    addJobStep(jobId, 2, TOTAL_STEPS, 'in_progress', 'Logging into carrier portal...');
    addJobStep(jobId, 3, TOTAL_STEPS, 'in_progress', 'Accessed mobile application portal');
    addJobStep(
      jobId,
      14,
      TOTAL_STEPS,
      'completed',
      'Completed: Application Number captured: M001234567'
    );
    return {
      success: true,
      applicationNumber: 'M001234567',
      customer: `${inputData.firstName} ${inputData.lastName}`,
      state: inputData.state,
      coverage: inputData.selectedCoverage,
    };
  }

  let data = inputData;
  if (process.env.AUTOMATION_TEST_MODE === 'true') {
    console.warn('[CarrierRPA] ⚠ AUTOMATION_TEST_MODE=true — using sample test values!');
    data = buildTestModeData(inputData);
  }

  const agentId = process.env.AMERICAN_AMICABLE_AGENT_ID;
  const password = process.env.AMERICAN_AMICABLE_PASSWORD;
  const signatureName = process.env.AMERICAN_AMICABLE_SIGNATURE_NAME;

  const missing = [
    !agentId && 'AMERICAN_AMICABLE_AGENT_ID',
    !password && 'AMERICAN_AMICABLE_PASSWORD',
    !signatureName && 'AMERICAN_AMICABLE_SIGNATURE_NAME',
  ].filter(Boolean);
  if (missing.length > 0) {
    const missingErr = `Missing required environment variables: ${missing.join(', ')}`;
    console.error(`[CarrierRPA] Error: ${missingErr}`);
    throw new Error(missingErr);
  }

  let browser: Browser | null = null;
  let activePage: Page | null = null;
  let debugSnapshotPath: string | null = null;

  try {
    const launched = await launchBrowser(jobId);
    browser = launched.browser;
    activePage = launched.page;

    await loginToAmericanAmicable(activePage, agentId!, password!, jobId);
    activePage = await navigateToMobilePortal(activePage, agentId!, password!, jobId);

    if (data.retryMode) {
      log('▶▶▶ RETRY MODE ACTIVE ◀◀◀');
      addJobStep(
        jobId,
        4,
        TOTAL_STEPS,
        'in_progress',
        'Retry mode: Finding pending application...'
      );

      const clickedPending = await activePage.evaluate(() => {
        const links = document.querySelectorAll('a');
        for (const link of Array.from(links)) {
          if (link.textContent && link.textContent.toLowerCase().includes('pending')) {
            link.click();
            return true;
          }
        }
        return false;
      });

      if (clickedPending) {
        await sleep(3000);
      }

      const recoverySuccess = await attemptRecoveryFlow(
        activePage,
        `${data.firstName} ${data.lastName}`
      );
      if (!recoverySuccess) {
        throw new Error('Recovery flow failed - could not re-enter pending application');
      }
    } else {
      await startNewApplication(activePage, jobId);
      await selectAgent(activePage, agentId!, jobId);
      await selectProduct(activePage, jobId);
      await selectState(activePage, data.state, agentId!, jobId);
      await fillQuoteForm(activePage, data, jobId);
      await fillHealthQuestions(activePage, data, jobId);
      await fillPersonalAndBanking(activePage, data, jobId);
      await validateBankInfo(activePage, jobId);
      await continueToAgentStatement(activePage, data, jobId);
    }

    await completeAgentStatement(activePage, data, jobId);
    const appNum = await selectVoiceRecordingAndCaptureApplicationNumber(activePage, jobId);

    return {
      success: true,
      message: 'Application ready for voice recording',
      applicationNumber: appNum,
      customer: `${data.firstName} ${data.lastName}`,
      state: data.state,
      coverage: data.selectedCoverage,
    };
  } catch (error) {
    console.error('[CarrierRPA] Error occurred during run:', (error as Error).message);
    if (activePage) {
      debugSnapshotPath = await captureDebugSnapshot(activePage, 'automation_crash_error').catch(
        () => null
      );
    }
    return { success: false, error: (error as Error).message, debugSnapshotPath };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};
