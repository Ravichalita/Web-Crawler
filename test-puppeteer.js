import puppeteer from 'puppeteer';

(async () => {
  try {
    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.goto('https://example.com');
    await page.pdf({ path: 'test.pdf' });
    await browser.close();
    console.log('Success');
  } catch (e) {
    console.error('Error:', e);
  }
})();
