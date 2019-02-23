const puppeteer = require('puppeteer');
const h2m = require('h2m');

const zhuanlanURL = 'https://zhuanlan.zhihu.com/p/56947560'

function wait (ms) {
  return new Promise(resolve => setTimeout(() => resolve(), ms));
}

function replaceAll(target, search, replacement) {
  return target.split(search).join(replacement);
};

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(zhuanlanURL, {
    waitUntil: 'load'
  });

  // 滚动页面到底，加载预加载图片
  // https://www.screenshotbin.com/blog/handling-lazy-loaded-webpages-puppeteer
  // Get the height of the rendered page
  const bodyHandle = await page.$('body');
  const {
    height
  } = await bodyHandle.boundingBox();
  await bodyHandle.dispose();

  // Scroll one viewport at a time, pausing to let content load
  const viewportHeight = page.viewport().height;
  let viewportIncr = 0;
  while (viewportIncr + viewportHeight < height) {
    await page.evaluate(_viewportHeight => {
      window.scrollBy(0, _viewportHeight);
    }, viewportHeight);
    await wait(20);
    viewportIncr = viewportIncr + viewportHeight;
  }


  const articleHTML = await page.evaluate(() => {
    // 修复代码格式
    document.querySelectorAll('pre').forEach(pre => pre.innerHTML = pre.innerText);
    // 避免重复
    document.querySelectorAll('noscript').forEach(ns => ns.remove());
    return document.querySelector('.Post-RichText').innerHTML;
  });

  let articleMD = h2m(articleHTML);

  // 修复链接
  articleMD = replaceAll(articleMD, 'http://link.zhihu.com/?target=https%3A', 'https:')
  articleMD = replaceAll(articleMD, 'http://link.zhihu.com/?target=http%3A', 'http:')

  console.log(articleMD);

  await browser.close();
})();