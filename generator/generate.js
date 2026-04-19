import puppeteer from 'puppeteer';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 神奈川県のエリアコード
const WEATHER_AREA = '140000';

async function fetchWeather() {
  const url = `https://www.jma.go.jp/bosai/forecast/data/forecast/${WEATHER_AREA}.json`;
  const res = await fetch(url);
  const data = await res.json();
  
  const today = data[0].timeSeries[0].areas[0].weathers[0];
  const todayCode = data[0].timeSeries[0].areas[0].weatherCodes[0];
  
  let temps = [];
  try {
    const tempSeries = data[1].timeSeries.find(t => t.areas[0].temps);
    if (tempSeries) {
      temps = tempSeries.areas[0].temps.map(Number);
    }
  } catch (e) {}
  
  return {
    today_weather: today,
    today_code: todayCode,
    temps: temps,
    updated: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
  };
}

async function fetchGasData() {
  const url = `${process.env.GAS_URL}?action=getDisplayData`;
  const res = await fetch(url);
  return res.json();
}

function getWeatherIcon(code) {
  const c = String(code);
  if (c.startsWith('1')) return '☀️';
  if (c.startsWith('2')) return '☁️';
  if (c.startsWith('3')) return '🌧️';
  if (c.startsWith('4')) return '❄️';
  return '🌤️';
}

function renderWeatherCalendarHTML(weather, events, settings) {
  const today = new Date();
  const ymd = today.toISOString().split('T')[0];
  
  const todayEvents = events.filter(e => e.date === ymd);
  const eventsHtml = todayEvents.length 
    ? todayEvents.map(e => {
        const color = e.person === settings.person1_name ? settings.person1_color :
                      e.person === settings.person2_name ? settings.person2_color : '#999';
        return `<div class="event"><span class="dot" style="background:${color}"></span>${e.title}<span class="person">${e.person}</span></div>`;
      }).join('')
    : '<div class="no-event">今日の予定はありません</div>';
  
  const icon = getWeatherIcon(weather.today_code);
  const temps = weather.temps.length >= 2 
    ? `${weather.temps[0]}° / ${weather.temps[1]}°`
    : '';

  return `
    <!DOCTYPE html>
    <html><head><meta charset="UTF-8"><style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { 
        width: 800px; height: 480px; 
        font-family: 'Noto Sans JP', sans-serif;
        background: white; color: #222;
        display: flex;
      }
      .left {
        width: 400px; padding: 30px;
        border-right: 2px solid #eee;
        display: flex; flex-direction: column;
      }
      .weather-icon { font-size: 140px; text-align: center; line-height: 1; }
      .weather-text { font-size: 32px; text-align: center; margin-top: 12px; font-weight: 600; }
      .temps { font-size: 28px; text-align: center; color: #666; margin-top: 8px; }
      .hourly { 
        display: flex; justify-content: space-around; margin-top: 30px;
        border-top: 1px solid #eee; padding-top: 20px;
      }
      .hourly-item { text-align: center; }
      .hourly-time { font-size: 18px; color: #666; }
      .hourly-icon { font-size: 40px; margin: 4px 0; }
      .hourly-temp { font-size: 20px; font-weight: 600; }
      
      .right { width: 400px; padding: 30px; display: flex; flex-direction: column; }
      .date-big { 
        font-size: 120px; font-weight: 900; line-height: 1;
        color: #E24A8B;
      }
      .date-sub { font-size: 22px; color: #666; margin-top: 8px; }
      .weekday { font-size: 28px; color: #4A90E2; margin-top: 8px; font-weight: 600; }
      .events-title { 
        font-size: 18px; color: #999; margin-top: 30px; 
        border-bottom: 2px solid #eee; padding-bottom: 6px;
      }
      .events { margin-top: 12px; }
      .event { 
        font-size: 20px; padding: 10px 0;
        display: flex; align-items: center;
        border-bottom: 1px solid #f5f5f5;
      }
      .dot { 
        display: inline-block; width: 12px; height: 12px; 
        border-radius: 50%; margin-right: 12px;
      }
      .person { 
        font-size: 14px; color: #999; margin-left: auto;
      }
      .no-event { color: #ccc; font-size: 18px; padding: 20px 0; }
      .updated { 
        position: absolute; bottom: 8px; right: 12px; 
        font-size: 10px; color: #bbb;
      }
    </style></head><body>
      <div class="left">
        <div class="weather-icon">${icon}</div>
        <div class="weather-text">${weather.today_weather}</div>
        <div class="temps">${temps}</div>
        <div class="hourly">
          <div class="hourly-item">
            <div class="hourly-time">9時</div>
            <div class="hourly-icon">${icon}</div>
            <div class="hourly-temp">${weather.temps[0] || '-'}°</div>
          </div>
          <div class="hourly-item">
            <div class="hourly-time">12時</div>
            <div class="hourly-icon">${icon}</div>
            <div class="hourly-temp">${weather.temps[1] || '-'}°</div>
          </div>
          <div class="hourly-item">
            <div class="hourly-time">16時</div>
            <div class="hourly-icon">${icon}</div>
            <div class="hourly-temp">${weather.temps[1] || '-'}°</div>
          </div>
        </div>
      </div>
      <div class="right">
        <div class="date-big">${today.getDate()}</div>
        <div class="date-sub">${today.getFullYear()}年 ${today.getMonth() + 1}月</div>
        <div class="weekday">${['日','月','火','水','木','金','土'][today.getDay()]}曜日</div>
        <div class="events-title">今日の予定</div>
        <div class="events">${eventsHtml}</div>
      </div>
      <div class="updated">更新: ${weather.updated}</div>
    </body></html>
  `;
}

function renderMonthCalendarHTML(events, settings) {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  
  const eventsByDate = {};
  events.forEach(e => {
    if (e.date.startsWith(`${year}-${String(month+1).padStart(2,'0')}`)) {
      const d = parseInt(e.date.split('-')[2]);
      if (!eventsByDate[d]) eventsByDate[d] = [];
      eventsByDate[d].push(e);
    }
  });
  
  let cells = '';
  for (let i = 0; i < firstDay; i++) cells += '<div class="cell empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = d === today.getDate();
    const dayEvents = eventsByDate[d] || [];
    const dots = dayEvents.map(e => {
      const c = e.person === settings.person1_name ? settings.person1_color :
                e.person === settings.person2_name ? settings.person2_color : '#999';
      return `<span class="dot" style="background:${c}"></span>`;
    }).join('');
    cells += `
      <div class="cell ${isToday ? 'today' : ''}">
        <div class="day">${d}</div>
        <div class="dots">${dots}</div>
      </div>`;
  }
  
  return `
    <!DOCTYPE html>
    <html><head><meta charset="UTF-8"><style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { 
        width: 800px; height: 480px; 
        font-family: 'Noto Sans JP', sans-serif;
        padding: 20px 30px; background: white;
      }
      .header { display: flex; align-items: baseline; margin-bottom: 10px; }
      .month { font-size: 56px; font-weight: 900; color: #4A90E2; }
      .year { font-size: 22px; color: #999; margin-left: 12px; }
      .legend { margin-left: auto; font-size: 14px; color: #666; }
      .legend-item { display: inline-flex; align-items: center; margin-left: 16px; }
      .legend-dot { width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; }
      .weekdays, .grid { display: grid; grid-template-columns: repeat(7, 1fr); }
      .weekdays { font-size: 14px; color: #999; text-align: center; padding: 6px 0; border-bottom: 1px solid #eee; }
      .weekdays div:first-child { color: #E24A8B; }
      .weekdays div:last-child { color: #4A90E2; }
      .cell { 
        border-right: 1px solid #f5f5f5; border-bottom: 1px solid #f5f5f5;
        padding: 6px; height: 62px; position: relative;
      }
      .cell.empty { background: #fafafa; }
      .day { font-size: 18px; font-weight: 600; }
      .cell.today .day { 
        background: #E24A8B; color: white; 
        width: 28px; height: 28px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
      }
      .dots { margin-top: 4px; }
      .dot { 
        display: inline-block; width: 8px; height: 8px; 
        border-radius: 50%; margin-right: 3px;
      }
    </style></head><body>
      <div class="header">
        <div class="month">${month + 1}</div>
        <div class="year">${year}年</div>
        <div class="legend">
          <span class="legend-item"><span class="legend-dot" style="background:${settings.person1_color}"></span>${settings.person1_name}</span>
          <span class="legend-item"><span class="legend-dot" style="background:${settings.person2_color}"></span>${settings.person2_name}</span>
        </div>
      </div>
      <div class="weekdays"><div>日</div><div>月</div><div>火</div><div>水</div><div>木</div><div>金</div><div>土</div></div>
      <div class="grid">${cells}</div>
    </body></html>
  `;
}

function renderPhotoHTML(imageUrl) {
  if (!imageUrl) {
    return `
      <!DOCTYPE html><html><body style="width:800px;height:480px;margin:0;display:flex;align-items:center;justify-content:center;font-family:sans-serif;font-size:24px;color:#999;">
      画像が選択されていません
      </body></html>`;
  }
  return `
    <!DOCTYPE html><html><body style="width:800px;height:480px;margin:0;background:black;display:flex;align-items:center;justify-content:center;">
    <img src="${imageUrl}" style="max-width:100%;max-height:100%;object-fit:contain;">
    </body></html>`;
}

async function main() {
  console.log('Fetching data...');
  const gasData = await fetchGasData();
  const weather = await fetchWeather();
  
  const { settings, events } = gasData;
  const mode = settings.mode || 'weather_calendar';
  const hour = new Date().toLocaleString('ja-JP', { 
    timeZone: 'Asia/Tokyo', hour: 'numeric', hour12: false
  });
  
  let html;
  if (mode === 'photo') {
    html = renderPhotoHTML(gasData.imageUrl);
  } else {
    if (parseInt(hour) < 12) {
      html = renderWeatherCalendarHTML(weather, events, settings);
    } else {
      html = renderMonthCalendarHTML(events, settings);
    }
  }
  
  console.log('Launching Puppeteer...');
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 480, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  
  const outDir = path.join(__dirname, '..', 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  
  await page.screenshot({
    path: path.join(outDir, 'display.png'),
    fullPage: false,
    clip: { x: 0, y: 0, width: 800, height: 480 }
  });
  
  await browser.close();
  console.log('Done! Image saved to output/display.png');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
