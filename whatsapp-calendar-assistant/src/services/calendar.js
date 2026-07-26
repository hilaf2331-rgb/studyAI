const { google } = require('googleapis');
const config = require('../config');

function getCalendarClient() {
  const oauth2Client = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri,
  );
  oauth2Client.setCredentials({ refresh_token: config.google.refreshToken });
  return google.calendar({ version: 'v3', auth: oauth2Client });
}

/** Creates an event on the user's primary calendar. */
async function createEvent(event, timezone) {
  const calendar = getCalendarClient();
  const { data } = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: event.title,
      description: event.description,
      location: event.location,
      start: { dateTime: event.start_time, timeZone: timezone },
      end: { dateTime: event.end_time, timeZone: timezone },
    },
  });
  return data;
}

/** Lists events on the primary calendar within a date range. */
async function listEvents(queryRange) {
  const calendar = getCalendarClient();
  const { data } = await calendar.events.list({
    calendarId: 'primary',
    timeMin: queryRange.start,
    timeMax: queryRange.end,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 25,
  });
  return data.items || [];
}

/**
 * Finds the next upcoming event matching a free-text search and deletes it.
 * Returns the deleted event, or null if nothing matched.
 */
async function deleteEventByText(searchText) {
  const calendar = getCalendarClient();
  const { data } = await calendar.events.list({
    calendarId: 'primary',
    q: searchText,
    timeMin: new Date().toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 1,
  });

  const match = data.items && data.items[0];
  if (!match) return null;

  await calendar.events.delete({ calendarId: 'primary', eventId: match.id });
  return match;
}

module.exports = { createEvent, listEvents, deleteEventByText };
