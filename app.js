const { Client } = require("@notionhq/client");
const notion = new Client({ auth: process.env.NOTION_API_TOKEN });
const morgan = require('morgan');
const express = require('express');
const app = express();
const router = express.Router();

app.use(express.json()); 
app.use(express.urlencoded( {extended : false } ));
app.use(morgan('combined'));
app.use('/reserve', router);

router.post('/ground', async (req, res) => {
  console.log(req.body);
  await reserve(req.body, res, 'ground');
});

router.post('/basement', async (req, res) => {
  console.log(req.body);
  await reserve(req.body, res, 'basement');
});

router.post('/check/start_time', async (req, res) => {
  console.log(req.body);
  await reserveStartTimeCheck(req.body, res);
});

router.post('/check/client_info', async (req, res) => {
  console.log(req.body);
  await reserveClientInfoCheck(req.body, res);
});

async function reserve(reqBody, res, room_type) {
  
  const start_time = JSON.parse(reqBody.action.params.start_time).value;
  const duration = JSON.parse(reqBody.action.params.duration).value;
  const end_time = `${start_time.split('T')[0]}T${duration}`;
  const club_name = reqBody.action.params.club_name;
  const client_info = parseClientInfo(reqBody.action.params.client_info);
  const total_number = reqBody.action.params.total_number;
  let databaseId;
  let title;
  if (room_type === 'ground') {
      databaseId = process.env.NOTION_DATABASE_GROUND_ID;
      title = "지상 연습실을 대여했습니다";
  } else if (room_type === 'basement') {
      databaseId = process.env.NOTION_DATABASE_BASEMENT_ID;
      title = "지하 연습실을 대여했습니다";
  } else {
      console.log(`Invalid room_type: ${room_type}`);
      return;
  }

  if (isWrongHours(start_time, end_time)){
    description = `- 신청한 시간 : ${start_time.replace(/-/g, '/').replace('T', ' ').slice(0, -3)} - ${duration.slice(0, -3)}\n처음부터 다시 시도해주세요.`;
    res.send({"version": "2.0","template": {"outputs": [{ "textCard": {"title": "1시간부터 최대 6시간까지 신청 가능합니다. ","description": description,"buttons": [{ "label": "처음으로","action": "block","messageText": "처음으로"}]}}]}});
    return;
  }
 if (await checkOverlap(databaseId, start_time, end_time)) {
    description = `- 신청한 시간 : ${start_time.replace(/-/g, '/').replace('T', ' ').slice(0, -3)} - ${duration.slice(0, -3)}\n예약 현황을 조회하시고, 비어있는 시간에 다시 신청해주세요.`;
    res.send({"version": "2.0","template": {"outputs": [{ "textCard": {"title": "해당 일시에 겹치는 예약이 있습니다.","description": description,"buttons": [{ "label": "처음으로","action": "block","messageText": "처음으로"}]}}]}});
    return;
  }

  const hiddenName = hideMiddleChar(client_info.name);
  await addToNotion(notion, databaseId, room_type, start_time, end_time, club_name, hiddenName, client_info, total_number);

  description = `- 대여기간 : ${start_time.replace(/-/g, '/').replace('T', ' ').slice(0, -3)} - ${duration.slice(0, -3)} \n- 신청자 : ${hiddenName}(${club_name})\n- 총 인원 : ${total_number} \n\n- 연습실을 깨끗이 사용해주세요. 사용이 끝난 후, 실내화와 쓰레기 정리 부탁드립니다.\n만약 사용 후 미청소 사실이 확인되면, 한 달간 연습실 대여 신청이 금지됩니다.`;
  res.send({"version": "2.0","template": {"outputs": [{ "textCard": {"title": title,"description": description,"buttons": [{ "label": "처음으로","action": "block","messageText": "처음으로"}]}}]}});
}

async function addToNotion(notion, databaseId, room_type, start_time, end_time, club_name, hiddenName, client_info, total_number) {
  await notion.pages.create({
      parent: { database_id: databaseId },
      properties: {
        '제목':{
          "type": "title",
          "title": [{ "type": "text", "text": { "content": club_name } }]
        },
        '날짜': {
          "type": "date",
          "date": { "start": `${start_time}+09:00` , "end": `${end_time}+09:00` }
        },
        '신청자': {
          "type": "rich_text",
          "rich_text": [{ "type": "text", "text": { "content": hiddenName } }]
        }
      }
  });

  await notion.pages.create({
      parent: { database_id: process.env.NOTION_DATABASE_LOG_ID },
      properties: {
        'request': {
          "type": "multi_select",
          "multi_select": [{ "name": "reserve" }]
        },
        'room type': {
          "type": "multi_select",
          "multi_select": [{ "name": room_type }]
        },
        'club name':{
          "type": "title",
          "title": [{ "type": "text", "text": { "content": club_name } }]
        },
        'date': {
          "type": "date",
          "date": { "start": `${start_time}+09:00` , "end": `${end_time}+09:00` }
        },
        'client name': {
          "type": "rich_text",
          "rich_text": [{ "type": "text", "text": { "content": client_info.name } }]
        },
        'client major': {
          "type": "rich_text",
          "rich_text": [{ "type": "text", "text": { "content": client_info.major } }]
        },
        'client id': {
          "type": "rich_text",
          "rich_text": [{ "type": "text", "text": { "content": client_info.id } }]
        },
        'client phone': {
          "type": "rich_text",
          "rich_text": [{ "type": "text", "text": { "content": client_info.phone } }]
        },
        'total number': {
          "type": "rich_text",
          "rich_text": [{ "type": "text", "text": { "content": total_number } }]
        }
      }
  });
  return console.log('added to notion');
}

async function reserveStartTimeCheck (reqBody, res) {
  const utc = new Date();
  const now = new Date(utc.getTime() + (9 * 60 * 60 * 1000));

  const start_time = new Date( Date.parse (reqBody.value.origin));
  start_time.setUTCHours(start_time.getUTCHours() + 9);
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  if (now.getUTCHours() >= 18 && start_time.getUTCDate() == tomorrow.getUTCDate()) {
    res.send({"status": "FAIL"});
    return;
  }
  else if (start_time.getUTCDate() <= now.getUTCDate()) {
    res.send({"status": "FAIL" });
    return;
  }
  else if (start_time.getTime() > now.getTime() + 7 * 24 * 60 * 60 * 1000) {
    res.send({"status": "FAIL" });
    return;
  }
  else {
    res.send({"status": "SUCCESS"});
    return;
  }
}

async function reserveClientInfoCheck (reqBody, res) {
  const str = reqBody.value.origin;
  const cleaned = str.replace(/[\s-]/g, '');
  const parts = cleaned.split(',');
  if (parts.length !== 4) {
    return res.send({"status": "FAIL" });
  }
  else{
    return res.send({"status": "SUCCESS" });
  }
    
}

function parseClientInfo(str) {
  const cleaned = str.replace(/[\s-]/g, '');
  const parts = cleaned.split(',');
  return {
    name: parts[0],
    major: parts[1],
    id: parts[2],
    phone: parts[3]
  }; 
}

function hideMiddleChar(str) {
  let chars = Array.from(str);
  const middleIndex = Math.floor(chars.length / 2);
  chars[middleIndex] = '*';
  return chars.join('');
}

async function checkOverlap(databaseId, start_time, end_time) {
  console.log(start_time.split('T')[0]);
  const existingReservations = await notion.databases.query({
    database_id: databaseId,
    filter: {
      property: '날짜',
      date: {
        equals: start_time.split('T')[0],
      },
    },
  });
  console.log("노션 데이터 베이스 불러옴");
  console.log(existingReservations);
  if (existingReservations.results.length === 0) {
    console.log("이날에 데이터 없는데");
    return false;
  }
  else {
    const start_date = new Date(start_time);
    console.log("스타드 타임");
    console.log(start_date);

    for (let i = 0; i < existingReservations.results.length; i++) {
      let reservation = existingReservations.results[i];
      let reservationStart = reservation.properties['날짜'].date.start;
      console.log("기존예약 시작");
      console.log(reservationStart);

      let reservationEnd = reservation.properties['날짜'].date.end;
      console.log("기존 예약 종료");
      console.log(reservationEnd);
      if ((start_time >= reservationStart && start_time < reservationEnd) || 
          (end_time > reservationStart && end_time <= reservationEnd)) {
        console.log("겹치는 데이터가 있네요");
        return true;
      }
    }
  }
  console.log("같은날인데 겹치진 않던데요");
  return false;
}

function isWrongHours(start_time, end_time) {
  let start = new Date(start_time);
  let end = new Date(end_time);
  let diffMillis = end - start;
  let hours = diffMillis / (1000 * 60 * 60);
  return hours > 6 || diffMillis <= 0;
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});