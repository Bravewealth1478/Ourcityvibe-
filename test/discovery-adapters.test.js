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

test("blocks private and reserved IPv4 and IPv6 ranges", () => {
  const { blockedIp } = require("../api/discovery/adapters");
  for (const ip of ["127.0.0.1","10.0.0.1","172.16.0.1","192.168.1.1","169.254.1.1","100.64.0.1","198.51.100.2","203.0.113.4","224.0.0.1","::1","fc00::1","fe80::1","ff02::1","2001:db8::1"]) {
    assert.equal(blockedIp(ip), true, ip + " should be blocked");
  }
  for (const ip of ["8.8.8.8","1.1.1.1","2606:4700:4700::1111"]) {
    assert.equal(blockedIp(ip), false, ip + " should be allowed");
  }
});

test("enforces source-specific response content types", () => {
  const { allowedContentType } = require("../api/discovery/adapters");
  assert.equal(allowedContentType("api", "application/json; charset=utf-8"), true);
  assert.equal(allowedContentType("rss", "application/rss+xml"), true);
  assert.equal(allowedContentType("ical", "text/calendar; charset=utf-8"), true);
  assert.equal(allowedContentType("website", "text/html"), true);
  assert.equal(allowedContentType("api", "image/png"), false);
  assert.equal(allowedContentType("rss", "text/html"), false);
});

test("normalises Ticketmaster Discovery API event payloads", () => {
  const rows = parseJsonApi(JSON.stringify({ _embedded: { events: [{
    id: "tm-1", name: "Lagos not relevant", url: "https://ticketmaster.example/event/tm-1",
    dates: { start: { dateTime: "2027-05-10T19:00:00Z" } },
    images: [{ url: "https://images.example/tm-1.jpg" }],
    _embedded: { venues: [{ name: "Arena", city: { name: "London" }, country: { name: "United Kingdom", countryCode: "GB" } }] }
  }] } }), { ...source, config: { provider: "ticketmaster" } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].external_id, "tm-1");
  assert.equal(rows[0].city, "London");
  assert.equal(rows[0].country_code, "GB");
  assert.equal(rows[0].venue_name, "Arena");
  assert.equal(rows[0].ticket_url, "https://ticketmaster.example/event/tm-1");
});

test("normalises Eventbrite API event payloads", () => {
  const rows = parseJsonApi(JSON.stringify({ events: [{
    id: "eb-1", name: { text: "Lagos Tech Meetup" }, description: { text: "A community technology event" },
    url: "https://www.eventbrite.com/e/eb-1", start: { utc: "2027-06-01T17:00:00Z" },
    logo: { url: "https://img.example/eb-1.jpg" },
    venue: { name: "Civic Centre", address: { city: "Lagos", country: "Nigeria", country_code: "NG" } }
  }] }), { ...source, config: { provider: "eventbrite" } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Lagos Tech Meetup");
  assert.equal(rows[0].city, "Lagos");
  assert.equal(rows[0].country_code, "NG");
  assert.equal(rows[0].venue_name, "Civic Centre");
  assert.equal(rows[0].image_url, "https://img.example/eb-1.jpg");
});

test("does not mistake an RSS article publication date for an event start date", () => {
  const xml = '<rss><channel><item><title>Event announcement article</title><description>Read about an upcoming festival</description><link>https://events.example.org/article</link><pubDate>Wed, 10 Feb 2027 18:00:00 GMT</pubDate></item></channel></rss>';
  const rows = parseRssAtom(xml, source);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].event_date, null);
});
