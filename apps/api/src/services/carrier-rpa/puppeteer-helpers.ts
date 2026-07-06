/**
 * Puppeteer helper utilities for carrier RPA.
 *
 * Ported from fe-rickie/server/services/automation/puppeteerHelpers.js.
 */

/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unnecessary-type-assertion -- page.evaluate callbacks execute in the browser DOM context, which typed linting cannot resolve */

import fs from 'fs';
import path from 'path';

import type { Page } from 'puppeteer';

/**
 * Wait for a selector and click it.
 */
export const waitAndClick = async (
  page: Page,
  selector: string,
  timeout = 10000
): Promise<void> => {
  await page.waitForSelector(selector, { timeout });
  await page.click(selector);
};

/**
 * Wait for a selector and type text into it.
 */
export const safeType = async (
  page: Page,
  selector: string,
  text: string | number,
  delay = 10
): Promise<void> => {
  await page.waitForSelector(selector, { timeout: 10000 });
  await page.type(selector, String(text), { delay });
};

/**
 * Click a text box 3 times to select all text, clear it, and type new text.
 */
export const clearAndType = async (
  page: Page,
  selector: string,
  text: string | number,
  delay = 10
): Promise<void> => {
  await page.waitForSelector(selector, { timeout: 10000 });
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type(selector, String(text), { delay });
};

/**
 * Select an option in a dropdown by value or visible text.
 */
export const selectByValueOrText = async (
  page: Page,
  selector: string,
  valueOrText: string
): Promise<void> => {
  await page.waitForSelector(selector, { timeout: 10000 });

  try {
    await page.select(selector, String(valueOrText));
    return;
  } catch {
    // Fall through to matching by option text
  }

  const found = await page.evaluate(
    (sel, matchText) => {
      const select = document.querySelector(sel) as HTMLSelectElement | null;
      if (!select) return false;
      const cleanMatch = String(matchText).trim().toLowerCase();

      for (const opt of Array.from(select.options)) {
        if (
          opt.value.trim().toLowerCase() === cleanMatch ||
          opt.text.trim().toLowerCase() === cleanMatch ||
          opt.text.toLowerCase().includes(cleanMatch)
        ) {
          opt.selected = true;
          select.value = opt.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
      return false;
    },
    selector,
    valueOrText
  );

  if (!found) {
    throw new Error(`Could not find option matching "${valueOrText}" in dropdown "${selector}"`);
  }
};

/**
 * Select a radio button and dispatch change/input events.
 */
export const clickRadioWithEvents = async (page: Page, selector: string): Promise<void> => {
  await page.waitForSelector(selector, { timeout: 10000 });
  await page.evaluate(sel => {
    const radio = document.querySelector(sel) as HTMLInputElement | null;
    if (radio) {
      radio.checked = true;
      radio.click();
      radio.dispatchEvent(new Event('change', { bubbles: true }));
      radio.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, selector);
};

/**
 * Wait for navigation or time out gracefully.
 */
export const waitForNavigationOrTimeout = async (page: Page, timeout = 30000): Promise<void> => {
  await page.waitForNavigation({ waitUntil: 'networkidle0', timeout }).catch(() => {
    // Ignore timeout gracefully
  });
};

/**
 * Capture a screenshot to the screenshots/ folder for debugging failed runs.
 * The screenshot may show form contents — the folder must never be exposed
 * publicly and paths are only referenced in internal fields/logs.
 */
export const captureDebugSnapshot = async (page: Page, name: string): Promise<string | null> => {
  try {
    const sanitizedName = String(name).replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${sanitizedName}_${Date.now()}.png`;
    const screenshotsDir = path.join(process.cwd(), 'screenshots');

    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }

    const screenshotPath = path.join(screenshotsDir, filename);
    await page.screenshot({ path: screenshotPath });
    console.log(`[CarrierRPA] Debug snapshot captured: ${screenshotPath}`);
    return screenshotPath;
  } catch (e) {
    console.error(`[CarrierRPA] Failed to capture debug snapshot:`, (e as Error).message);
    return null;
  }
};
