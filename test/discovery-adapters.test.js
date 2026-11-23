"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseJsonApi, parseRssAtom, parseIcal, parseJsonLd } = require("../api/discovery/adapters");

const source = { base_url: "https://events.example.org/feed" };

test("normalises nested JSON API event records", () => {
  const rows = parseJsonApi(JSON.stringify({ data: { events: [{
    id: "evt-1", name: "Global Music Night", startDate: "2027-02-10T18:00:00Z",
    url: "https://tickets.example.org/evt-1", location: { name: "Main Hall", address: { addressLocality: "Lagos", addressCountry: "NG" } }
  }] } }), { ...source, config: { items_path: "data.events" } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Global Music Night");
  assert.equal(rows[0].city, "Lagos");
  assert.equal(rows[0].ticket_url, "https://tickets.example.org/evt-1");
});

test("parses RSS items into common event records", () => {
  const xml = '<rss><channel><item><guid>rss-1</guid><title>Art Festival</title><description>Local art and culture</description><link>https://events.example.org/art</link><pubDate>Wed, 10 Feb 2027 18:00:00 GMT</pubDate></item></channel></rss>';
  const rows = parseRssAtom(xml, source);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Art Festival");
  assert.equal(rows[0].external_id, "rss-1");
});

test("parses iCalendar VEVENT records", () => {
  const ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:ical-1\r\nSUMMARY:Community Expo\r\nDTSTART:20270210T180000Z\r\nURL:https://events.example.org/expo\r\nLOCATION:Civic Centre\r\nEND:VEVENT\r\nEND:VCALENDAR";
  const rows = parseIcal(ics, source);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Community Expo");
  assert.equal(rows[0].venue_name, "Civic Centre");
});

test("extracts Schema.org Event JSON-LD from a website page", () => {
  const html = '<html><script type="application/ld+json">{"@context":"https://schema.org","@type":"MusicEvent","name":"Live in London","startDate":"2027-03-01T20:00:00Z","url":"https://events.example.org/live","location":{"@type":"Place","name":"Arena","address":{"@type":"PostalAddress","addressLocality":"London","addressCountry":"GB"}}}</script></html>';
  const rows = parseJsonLd(html, source);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Live in London");
  assert.equal(rows[0].country_code, "GB");
});
