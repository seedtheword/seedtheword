/* ============================================================
   Google Calendar Integration - Single Source of Truth
   ============================================================ */

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/** Convert a Google Calendar HTML description to a plain-text string.
 *  Handles <br>, <p>, <div>, <li>, <b>, <i>, <u>, <a>, decodes entities.
 */
function stripHtmlToText(html) {
  if (html == null) return '';
  let s = String(html);
  // Treat | as a line separator (legacy admin convention in the repo)
  s = s.replace(/\|/g, '\n');
  // Block-level tags become newlines
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '• ');
  // Strip every other tag
  s = s.replace(/<[^>]+>/g, '');
  // Decode common HTML entities
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–');
  // Numeric entities (e.g. &#8217;)
  s = s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)));
  s = s.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
  // Collapse runs of 3+ newlines to just 2, trim trailing whitespace on lines
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

/** HTML-safe rendering of a description for the modal — preserves line
 *  breaks but never re-inserts the raw tags from Google Calendar. */
function renderDescription(html) {
  const text = stripHtmlToText(html);
  return escapeHtml(text).replace(/\n/g, '<br>');
}

/** Trim a string to ~max chars without cutting mid-word. Adds an
 *  ellipsis if trimmed. */
function smartTrim(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  // Try to cut on the last space / newline / punctuation before max
  const hardStop = text.slice(0, max);
  const softStop = hardStop.replace(/\s+\S*$/, '');
  const base = softStop.length > max * 0.7 ? softStop : hardStop;
  return base.trim().replace(/[,;:.\-–—\s]+$/, '') + '…';
}

/** Best-effort extraction of {lat, lng} from a Google Calendar event.
 *  Looks at extendedProperties.private (the standard place Google stores
 *  geo data) and falls back to a simple "lat,lng" or "@lat,lng" pattern
 *  in the location string. Returns null if nothing's found. */
function getEventCoords(event) {
  if (!event) return null;
  const ext = event.extendedProperties && (event.extendedProperties.private || event.extendedProperties.shared);
  if (ext && ext.geo) {
    const m = String(ext.geo).match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  }
  if (event.location) {
    // Match "47.951389,-122.289641" anywhere, optionally prefixed with @
    const m = String(event.location).match(/@?\s*(-?\d{1,3}(?:\.\d+))\s*,\s*(-?\d{1,3}(?:\.\d+))/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  }
  return null;
}

class GoogleCalendarIntegration {
  constructor() {
    // Your actual Google Calendar API credentials
    this.apiKey = 'AIzaSyA6GMEdyQHxcRCJuun-OIrFlJgG67Zjtpc';
    this.calendarId = 'seedthewordministry@gmail.com';
    
    this.events = [];
    this.currentDate = new Date();
    this.currentMonth = this.currentDate.getMonth();
    this.currentYear = this.currentDate.getFullYear();
    
    this.init();
  }
  
  async init() {
    await this.loadEvents();
    this.renderCalendar();
    this.renderEventCards();
    this.bindEvents();
    this.maybeOpenEventFromHash();
  }

  /** If the URL contains #event=<id>, open that event's modal on load. */
  maybeOpenEventFromHash() {
    const m = (window.location.hash || '').match(/^#event=(.+)$/);
    if (!m) return;
    const wantedId = decodeURIComponent(m[1]);
    const target = this.events.find(e => e.id === wantedId);
    if (!target) {
      // Event may be outside our fetched window or simply gone
      console.info('Shared event id not found in current window:', wantedId);
      return;
    }
    // Defer so the calendar finishes painting first
    setTimeout(() => this.showEventModal(target, this.getEventStart(target)), 50);
  }
  
  async loadEvents() {
    try {
      console.log('📅 Loading events from Google Calendar...');
      console.log('🔗 Calendar ID:', this.calendarId);
      
      const events = await this.fetchGoogleCalendarEvents();
      if (events && events.length > 0) {
        this.events = events;
        console.log('✅ Successfully loaded', events.length, 'events from Google Calendar');
        console.log('📋 Event titles:', events.map(e => e.summary).slice(0, 10)); // Show first 10 event titles
        this.updateLastRefreshTime();
      } else {
        console.log('📭 No events found in Google Calendar');
        this.events = [];
        this.showCalendarSetupMessage();
        this.updateLastRefreshTime();
      }
      
    } catch (error) {
      console.error('⚠️ Google Calendar API Error:', error.message);
      this.events = [];
      this.showCalendarErrorMessage(error.message);
      this.updateLastRefreshTime('Error');
    }
  }
  
  updateLastRefreshTime(status = 'Success') {
    const lastUpdatedEl = document.getElementById('calendar-last-updated');
    if (lastUpdatedEl) {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        timeZoneName: 'short'
      });
      
      if (status === 'Error') {
        lastUpdatedEl.textContent = `Last refresh: ${timeStr} (Error)`;
        lastUpdatedEl.style.color = 'var(--red)';
      } else {
        lastUpdatedEl.textContent = `Last refresh: ${timeStr}`;
        lastUpdatedEl.style.color = 'var(--muted)';
      }
    }
  }
  
  showCalendarSetupMessage() {
    const containers = ['live-events-container', 'upcoming-events-container', 'ongoing-ministries-container'];
    containers.forEach(containerId => {
      const container = document.getElementById(containerId);
      if (container) {
        container.innerHTML = `
          <div class="event-card setup glass-morphism" style="padding: 1rem; text-align: center;">
            <h4 style="color: var(--green); margin-bottom: 0.5rem;">📅 Set Up Your Calendar</h4>
            <p style="font-size: 0.8rem; color: var(--muted); margin-bottom: 1rem;">
              Add events to your Google Calendar to see them here automatically.
            </p>
            <a href="https://calendar.google.com/calendar/u/0/r" target="_blank" class="btn btn-primary btn-sm">
              Open Google Calendar
            </a>
          </div>
        `;
      }
    });
  }
  
  showCalendarErrorMessage(error) {
    const containers = ['live-events-container', 'upcoming-events-container', 'ongoing-ministries-container'];
    containers.forEach(containerId => {
      const container = document.getElementById(containerId);
      if (container) {
        container.innerHTML = `
          <div class="event-card error glass-morphism" style="padding: 1rem; text-align: center;">
            <h4 style="color: var(--red); margin-bottom: 0.5rem;">⚠️ Calendar Error</h4>
            <p style="font-size: 0.8rem; color: var(--muted); margin-bottom: 1rem;">
              ${error}
            </p>
            <button onclick="window.googleCalendar.refresh()" class="btn btn-secondary btn-sm">
              Try Again
            </button>
          </div>
        `;
      }
    });
  }
  
  async fetchGoogleCalendarEvents() {
    const timeMin = new Date();
    timeMin.setMonth(timeMin.getMonth() - 1); // Get events from last month
    const timeMax = new Date();
    timeMax.setMonth(timeMax.getMonth() + 6); // Get events for next 6 months
    
    const directUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events?` +
      `key=${this.apiKey}&` +
      `timeMin=${timeMin.toISOString()}&` +
      `timeMax=${timeMax.toISOString()}&` +
      `singleEvents=true&` +
      `orderBy=startTime&` +
      `maxResults=100`;
    
    console.log('🔗 Fetching from Google Calendar API:', this.calendarId);
    
    try {
      const response = await fetch(directUrl);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Google Calendar API Error:', response.status, response.statusText);
        
        // Try to parse error for more details
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error) {
            throw new Error(`${errorData.error.message} (${errorData.error.code})`);
          }
        } catch (parseError) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      }
      
      const data = await response.json();
      console.log('✅ Google Calendar API Success:', data.items?.length || 0, 'events loaded');
      return data.items || [];
      
    } catch (fetchError) {
      console.error('❌ Fetch Error:', fetchError.message);
      
      // Provide specific error messages for common issues
      if (fetchError.message.includes('403')) {
        throw new Error('Calendar access denied. Make sure your calendar is public or check API permissions.');
      } else if (fetchError.message.includes('404')) {
        throw new Error('Calendar not found. Check calendar ID and visibility settings.');
      } else if (fetchError.message.includes('400')) {
        throw new Error('Bad request. Check API key format and parameters.');
      } else {
        throw fetchError;
      }
    }
  }
  
  renderCalendar() {
    const calendarGrid = document.getElementById('calendar-grid');
    const monthDisplay = document.getElementById('calendar-month');
    
    if (!calendarGrid || !monthDisplay) {
      console.error('❌ Calendar elements not found in DOM');
      return;
    }
    
    console.log('🎨 Rendering calendar for', this.currentMonth + 1, '/', this.currentYear);
    
    // Clear existing content
    calendarGrid.innerHTML = '';
    
    // Ensure grid layout is applied inline (defensive)
    calendarGrid.style.display = 'grid';
    calendarGrid.style.gridTemplateColumns = 'repeat(7, 1fr)';
    calendarGrid.style.gap = '8px';
    
    // Update month display
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    monthDisplay.textContent = `${monthNames[this.currentMonth]} ${this.currentYear}`;

    // Apply the monthly calendar-template image as a subtle backdrop
    // behind the calendar header. Image numbers are 1..12 matching month number.
    const headerEl = document.querySelector('.calendar-header');
    if (headerEl) {
      const monthNum = this.currentMonth + 1; // 1..12
      headerEl.style.setProperty(
        '--calendar-month-bg',
        `url('assets/images/calendar-template/${monthNum}.jpg')`
      );
      headerEl.classList.add('has-month-bg');
    }
    
    // Add day headers
    const dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    dayHeaders.forEach(day => {
      const header = document.createElement('div');
      header.className = 'calendar-day-header';
      header.textContent = day;
      calendarGrid.appendChild(header);
    });
    
    // Get first day of month and number of days
    const firstDay = new Date(this.currentYear, this.currentMonth, 1);
    const lastDay = new Date(this.currentYear, this.currentMonth + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();
    
    let cellsCreated = 0;
    
    // Add empty cells for days before month starts
    for (let i = 0; i < startingDayOfWeek; i++) {
      const prevMonthDay = new Date(this.currentYear, this.currentMonth, 0 - (startingDayOfWeek - 1 - i));
      try {
        const dayCell = this.createDayCell(prevMonthDay.getDate(), true);
        calendarGrid.appendChild(dayCell);
        cellsCreated++;
      } catch (err) {
        console.error('Error creating prev-month cell:', err);
      }
    }
    
    // Add days of current month
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(this.currentYear, this.currentMonth, day);
      try {
        const dayCell = this.createDayCell(day, false, date);
        calendarGrid.appendChild(dayCell);
        cellsCreated++;
      } catch (err) {
        console.error(`Error creating cell for day ${day}:`, err);
      }
    }
    
    // Add empty cells for days after month ends to fill grid to 42 cells
    const cellsNeeded = 42 - cellsCreated;
    for (let i = 1; i <= cellsNeeded; i++) {
      try {
        const dayCell = this.createDayCell(i, true);
        calendarGrid.appendChild(dayCell);
      } catch (err) {
        console.error('Error creating trailing cell:', err);
      }
    }
    
    console.log(`✅ Calendar rendered: ${cellsCreated} active cells, ${daysInMonth} days in month`);
  }
  
  createDayCell(dayNumber, isOtherMonth = false, date = null) {
    const dayCell = document.createElement('div');
    dayCell.className = 'calendar-day';
    
    if (isOtherMonth) {
      dayCell.classList.add('other-month');
    }
    
    // Check if this is today
    if (date && this.isToday(date)) {
      dayCell.classList.add('today');
    }
    
    // Add day number with explicit inline styles to guarantee visibility
    const dayNumberEl = document.createElement('div');
    dayNumberEl.className = 'calendar-day-number';
    dayNumberEl.textContent = dayNumber;
    dayNumberEl.style.fontSize = '1.1rem';
    dayNumberEl.style.fontWeight = '700';
    dayNumberEl.style.color = isOtherMonth ? '#b0b0b0' : '#1a1a1a';
    dayNumberEl.style.marginBottom = '0.25rem';
    dayCell.appendChild(dayNumberEl);
    
    // Add events for this day
    if (date && !isOtherMonth) {
      const dayEvents = this.getEventsForDate(date);
      dayEvents.forEach(event => {
        const eventEl = document.createElement('div');
        eventEl.className = `calendar-event ${this.getEventType(event)}`;
        eventEl.textContent = this.truncateText(event.summary || event.title || 'Event', 15);
        eventEl.addEventListener('click', (e) => {
          e.stopPropagation();
          this.showEventModal(event, date);
        });
        dayCell.appendChild(eventEl);
      });
    }
    
    return dayCell;
  }
  
  renderEventCards() {
    this.renderLiveEvents();
    this.renderUpcomingEvents();
    this.renderOngoingMinistries();
  }
  
  renderUpcomingEvents() {
    const container = document.getElementById('upcoming-events-container');
    if (!container) return;
    
    const now = new Date();
    const upcomingEvents = this.events
      .filter(event => {
        const start = this.getEventStart(event);
        return start && start > now;
      })
      .slice(0, 3); // Limit to 3 for compact layout
    
    if (upcomingEvents.length === 0) {
      container.innerHTML = `
        <div class="event-card setup glass-morphism" style="padding: 1rem; text-align: center;">
          <h4 style="color: var(--green); margin-bottom: 0.5rem;">📅 No Upcoming Events</h4>
          <p style="font-size: 0.8rem; color: var(--muted); margin-bottom: 1rem;">
            Add events to your Google Calendar to see them here.
          </p>
          <a href="https://calendar.google.com/calendar/u/0/r" target="_blank" class="btn btn-primary btn-sm">
            Add Events
          </a>
        </div>
      `;
      return;
    }
    
    container.innerHTML = upcomingEvents.map(event => {
      const startDate = this.getEventStart(event);
      const eventType = this.getEventType(event);
      const statusText = this.getEventStatusForAnnouncement(startDate);
      
      return `
        <div class="event-card ${eventType} glass-morphism" style="padding: 0.75rem; margin-bottom: 0.5rem;" onclick="googleCalendar.showEventModal(${JSON.stringify(event).replace(/"/g, '&quot;')}, '${startDate.toISOString()}')">
          <div class="event-card__status" style="font-size: 0.7rem; margin-bottom: 0.375rem;">${statusText}</div>
          <div class="event-card__content">
            <h4 class="event-card__title" style="font-size: 0.9rem; margin-bottom: 0.25rem;">${event.summary || event.title}</h4>
            <p class="event-card__time" style="font-size: 0.75rem; margin-bottom: 0.375rem;">${this.formatCompactEventTime(startDate)}</p>
            <p class="event-card__description" style="font-size: 0.75rem; line-height: 1.3;">${this.truncateText(event.description || '', 80)}</p>
          </div>
        </div>
      `;
    }).join('');
  }
  
  renderOngoingMinistries() {
    const container = document.getElementById('ongoing-ministries-container');
    if (!container) return;
    
    // Filter for recurring/ongoing events
    const ongoingEvents = this.events.filter(event => 
      event.recurrence || (event.summary && (
        event.summary.toLowerCase().includes('daily') ||
        event.summary.toLowerCase().includes('weekly') ||
        event.summary.toLowerCase().includes('ongoing') ||
        event.summary.toLowerCase().includes('ministry')
      ))
    ).slice(0, 3);
    
    if (ongoingEvents.length === 0) {
      container.innerHTML = `
        <div class="event-card setup glass-morphism" style="padding: 1rem; text-align: center;">
          <h4 style="color: var(--green); margin-bottom: 0.5rem;">🔄 No Ongoing Ministries</h4>
          <p style="font-size: 0.8rem; color: var(--muted); margin-bottom: 1rem;">
            Create recurring events in Google Calendar for ongoing ministries.
          </p>
          <a href="https://calendar.google.com/calendar/u/0/r" target="_blank" class="btn btn-primary btn-sm">
            Add Recurring Events
          </a>
        </div>
      `;
      return;
    }
    
    container.innerHTML = ongoingEvents.map(event => {
      const startDate = this.getEventStart(event);
      
      return `
        <div class="event-card ongoing glass-morphism" style="padding: 0.75rem; margin-bottom: 0.5rem;" onclick="googleCalendar.showEventModal(${JSON.stringify(event).replace(/"/g, '&quot;')}, '${startDate.toISOString()}')">
          <div class="event-card__status" style="font-size: 0.7rem; margin-bottom: 0.375rem;">🔄 ONGOING</div>
          <div class="event-card__content">
            <h4 class="event-card__title" style="font-size: 0.9rem; margin-bottom: 0.25rem;">${event.summary || event.title}</h4>
            <p class="event-card__time" style="font-size: 0.75rem; margin-bottom: 0.375rem;">${this.getRecurringSchedule(event)}</p>
            <p class="event-card__description" style="font-size: 0.75rem; line-height: 1.3;">${this.truncateText(event.description || '', 80)}</p>
          </div>
        </div>
      `;
    }).join('');
  }
  
  renderLiveEvents() {
    const container = document.getElementById('live-events-container');
    if (!container) return;
    
    const now = new Date();
    const liveEvents = this.events.filter(event => {
      const start = this.getEventStart(event);
      const end = this.getEventEnd(event);
      if (!start || !end) return false;
      return start <= now && end >= now;
    });
    
    if (liveEvents.length === 0) {
      container.innerHTML = `
        <div class="event-card setup glass-morphism" style="padding: 1rem; text-align: center;">
          <h4 style="color: var(--green); margin-bottom: 0.5rem;">⏰ No Live Events</h4>
          <p style="font-size: 0.8rem; color: var(--muted); margin-bottom: 1rem;">
            No events are currently live. Check your calendar for upcoming events.
          </p>
          <a href="https://calendar.google.com/calendar/u/0/r" target="_blank" class="btn btn-primary btn-sm">
            View Calendar
          </a>
        </div>
      `;
      return;
    }
    
    container.innerHTML = liveEvents.map(event => `
      <div class="event-card glass-morphism live">
        <div class="event-card__status">🔴 LIVE NOW</div>
        <div class="event-card__content">
          <h4 class="event-card__title">${event.summary || event.title}</h4>
          <p class="event-card__time">Started ${this.formatEventTime(this.getEventStart(event))}</p>
          <p class="event-card__description">${event.description || ''}</p>
        </div>
        <div class="live-pulse"></div>
      </div>
    `).join('');
  }
  
  // Utility methods
  getEventStatusForAnnouncement(date) {
    if (!date) return '📅 UPCOMING';

    // Compare by local calendar day, not elapsed hours, so evening
    // events don't flip to "TOMORROW" just because they're > 24h ahead.
    const startOfLocalDay = (d) => {
      const copy = new Date(d);
      copy.setHours(0, 0, 0, 0);
      return copy;
    };

    const today = startOfLocalDay(new Date());
    const eventDay = startOfLocalDay(date);
    const dayDiff = Math.round((eventDay - today) / (1000 * 60 * 60 * 24));

    if (dayDiff === 0) return '📅 TODAY';
    if (dayDiff === 1) return '📅 TOMORROW';
    if (dayDiff > 1 && dayDiff <= 7) {
      const dayName = date.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
      return `📅 THIS ${dayName}`;
    }
    return '📅 UPCOMING';
  }
  
  formatCompactEventTime(date) {
    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
    const time = date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      timeZoneName: 'short'
    });
    return `${dayName}s • ${time}`;
  }
  
  getRecurringSchedule(event) {
    if (event.recurrence) {
      const startDate = this.getEventStart(event);
      if (!startDate) return 'Ongoing Ministry';
      const dayName = startDate.toLocaleDateString('en-US', { weekday: 'long' });
      const time = startDate.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        timeZoneName: 'short'
      });
      
      // Check recurrence rules
      const recurrenceRule = event.recurrence[0];
      if (recurrenceRule.includes('DAILY')) return `Daily • ${time}`;
      if (recurrenceRule.includes('WEEKLY')) return `${dayName}s • ${time}`;
      return `Regular Schedule • ${time}`;
    }
    
    return 'Ongoing Ministry';
  }
  
  getEventType(event) {
    const now = new Date();
    const start = this.getEventStart(event);
    const end = this.getEventEnd(event);
    if (!start || !end) return 'future';

    // Currently airing → live
    if (start <= now && end >= now) return 'live';

    // Recurring / routine (events with recurrence rules) → ongoing (blue)
    if (event.recurrence && start > now) return 'ongoing';

    // Starts today → today (green)
    const startOfLocalDay = (d) => {
      const c = new Date(d);
      c.setHours(0, 0, 0, 0);
      return c;
    };
    const today = startOfLocalDay(now);
    const startDay = startOfLocalDay(start);
    const dayDiff = Math.round((startDay - today) / (1000 * 60 * 60 * 24));

    if (dayDiff === 0) return 'today';
    if (dayDiff > 0 && dayDiff <= 7) return 'upcoming'; // within a week → yellow
    if (dayDiff > 7) return 'future';                   // further out → purple

    return 'ongoing'; // past non-recurring events default here
  }
  
  formatEventTime(date) {
    if (!date) return '';
    return date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    });
  }
  
  truncateText(text, maxLength) {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  }
  
  isToday(date) {
    const today = new Date();
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
  }
  
  getEventsForDate(date) {
    // Compare dates by LOCAL year/month/day to avoid UTC drift
    const localKey = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const dateStr = localKey(date);
    return this.events.filter(event => {
      // Handle both timed events (dateTime) and all-day events (date)
      const startValue = event.start?.dateTime || event.start?.date;
      if (!startValue) return false;
      const eventDate = localKey(new Date(startValue));
      return eventDate === dateStr;
    });
  }
  
  // Safe helper to get a Date from an event's start (handles all-day events too)
  getEventStart(event) {
    const value = event.start?.dateTime || event.start?.date;
    return value ? new Date(value) : null;
  }
  
  getEventEnd(event) {
    const value = event.end?.dateTime || event.end?.date;
    return value ? new Date(value) : null;
  }

  /** Returns {lat, lng} if the event carries lat/lng in extendedProperties
   *  or a parseable "@lat,lng" string, otherwise null. */
  getEventCoords(event) {
    // No-op wrapper around the module-level helper so instance code can use `this.`
    return getEventCoords(event);
  }
  
  showEventModal(event, date) {
    const modal = document.getElementById('event-modal');
    const modalBody = document.getElementById('event-modal-body');

    if (!modal || !modalBody) return;

    const startDate = this.getEventStart(event);
    const endDate = this.getEventEnd(event);
    if (!startDate || !endDate) return;

    const title = event.summary || event.title || 'Event';
    const niceTime = (d) => d.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
    const niceDate = startDate.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    const eventType = this.getEventType(event);
    const eventTypeLabels = {
      live: { label: 'LIVE NOW', className: 'event-modal__badge--live' },
      today: { label: 'TODAY', className: 'event-modal__badge--today' },
      upcoming: { label: 'UPCOMING', className: 'event-modal__badge--upcoming' },
      ongoing: { label: 'RECURRING', className: 'event-modal__badge--ongoing' },
      future: { label: 'FUTURE', className: 'event-modal__badge--future' },
    };
    const typeInfo = eventTypeLabels[eventType] || eventTypeLabels.upcoming;

    const hasLink = event.htmlLink && event.htmlLink !== '#';

    // Deep-link back to this event so it can be pasted into Telegram, IG, etc.
    const shareUrl = this.buildShareUrl(event);
    // Update the browser URL so reload/share from the address bar works too.
    try {
      history.replaceState(null, '', '#event=' + encodeURIComponent(event.id || ''));
    } catch (_) { /* non-critical */ }

    // Stash the event on the instance so the Copy / Share handlers have access
    this.currentEvent = event;

    modalBody.innerHTML = `
      <span class="event-modal__badge ${typeInfo.className}">${typeInfo.label}</span>
      <h3 class="event-modal__title">${escapeHtml(title)}</h3>
      <ul class="event-modal__meta">
        <li><span aria-hidden="true">📅</span><span>${niceDate}</span></li>
        <li><span aria-hidden="true">⏰</span><span>${niceTime(startDate)} – ${niceTime(endDate)}</span></li>
        ${event.location ? `<li><span aria-hidden="true">📍</span><span>${escapeHtml(event.location)}</span></li>` : ''}
      </ul>
      ${event.description ? `<div class="event-modal__desc">${renderDescription(event.description)}</div>` : ''}
      <div class="event-modal__actions">
        <div class="event-share" id="event-share-wrap">
          <button type="button" class="btn btn-primary event-share__toggle"
                  id="event-share-toggle"
                  aria-haspopup="true" aria-expanded="false"
                  aria-controls="event-share-menu">
            📣 Share Event <span class="event-share__caret" aria-hidden="true">▾</span>
          </button>
          <div class="event-share__menu" id="event-share-menu" role="menu" hidden></div>
        </div>
        ${hasLink ? `
          <a class="btn btn-outline-gold" href="${event.htmlLink}" target="_blank" rel="noopener">
            View on Google Calendar
          </a>
        ` : ''}
      </div>
      <p class="event-modal__share-hint" id="event-share-hint" aria-live="polite"></p>
    `;

    modal.style.display = 'flex';
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';

    // Wire up the share dropdown
    this.wireShareMenu(event, shareUrl);
  }

  /** Build the dropdown of share destinations and wire each action. */
  wireShareMenu(event, shareUrl) {
    const toggle = document.getElementById('event-share-toggle');
    const menu   = document.getElementById('event-share-menu');
    const hint   = document.getElementById('event-share-hint');
    if (!toggle || !menu) return;

    const announcement = this.buildShareText(event, shareUrl);

    // Destinations. Each entry renders a row; 'action' runs on click.
    const items = [];

    // 1) Native device share, if the browser exposes it (phones + some desktops).
    //    This gives Telegram, IG, WhatsApp, AirDrop, Mail, etc. in one sheet.
    if (typeof navigator.share === 'function') {
      items.push({
        icon: '📱',
        label: 'Device share…',
        desc: 'All apps on this device',
        action: async () => {
          try {
            await navigator.share({
              title: event.summary || 'Seed the Word event',
              text: announcement,
              url: shareUrl,
            });
            return { ok: true, msg: '✅ Shared.' };
          } catch (err) {
            if (err && err.name === 'AbortError') return { ok: true, msg: '' };
            return { ok: false, msg: '⚠️ Share cancelled.' };
          }
        },
      });
    }

    // 2) Telegram — pre-filled share sheet. Telegram's endpoint REQUIRES
    //    the `url` param (without it, the link just opens telegram.org).
    //    To avoid the URL appearing twice in the post, we hand Telegram
    //    the real deep link as `url` and send a body that:
    //      (a) has the trailing 'More Details' footer stripped, and
    //      (b) starts with a soft 'Website' divider so the post reads
    //          cleanly below Telegram's auto-generated URL preview card.
    const TG_DIVIDER = '━━━━━ 🌐 Website ━━━━━\n\n';
    const telegramBody = TG_DIVIDER + announcement
      .replace(/\n?More Details \([^)]*\)\s*$/i, '')
      .trimEnd();
    items.push({
      icon: '📣',
      label: 'Telegram',
      desc: 'Opens Telegram share sheet',
      href: `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(telegramBody)}`,
    });

    // 3) WhatsApp — same idea, different endpoint
    items.push({
      icon: '💬',
      label: 'WhatsApp',
      desc: 'Opens WhatsApp with the announcement',
      href: `https://wa.me/?text=${encodeURIComponent(announcement)}`,
    });

    // 4) Instagram — no public share API. Copy + open so admins can paste
    //    into a new story, DM, or post caption.
    items.push({
      icon: '📷',
      label: 'Instagram',
      desc: 'Copies caption, opens Instagram',
      action: async () => {
        const okCopy = await this.copyToClipboardSafe(announcement);
        window.open('https://www.instagram.com/seedtheword/', '_blank', 'noopener');
        return okCopy
          ? { ok: true, msg: '✅ Caption copied — paste into your post, story, or DM.' }
          : { ok: false, msg: 'Could not auto-copy. Use "Copy announcement" instead.' };
      },
    });

    // 5) Copy full announcement
    items.push({
      icon: '📋',
      label: 'Copy announcement',
      desc: 'Clipboard — paste anywhere',
      action: async () => {
        const ok = await this.copyToClipboardSafe(announcement);
        return ok
          ? { ok: true, msg: '✅ Announcement copied.' }
          : { ok: false, msg: 'Clipboard was blocked. Long-press the link in the modal to copy.' };
      },
    });

    // 6) Copy just the deep link
    items.push({
      icon: '🔗',
      label: 'Copy event link only',
      desc: 'Just the URL, no message',
      action: async () => {
        const ok = await this.copyToClipboardSafe(shareUrl);
        return ok
          ? { ok: true, msg: '✅ Event link copied.' }
          : { ok: false, msg: 'Clipboard was blocked.' };
      },
    });

    menu.innerHTML = items.map((it, i) => `
      ${it.href
        ? `<a class="event-share__item" role="menuitem" data-idx="${i}" href="${it.href}" target="_blank" rel="noopener">`
        : `<button type="button" class="event-share__item" role="menuitem" data-idx="${i}">`}
        <span class="event-share__item-icon" aria-hidden="true">${it.icon}</span>
        <span class="event-share__item-body">
          <span class="event-share__item-label">${escapeHtml(it.label)}</span>
          <span class="event-share__item-desc">${escapeHtml(it.desc)}</span>
        </span>
      ${it.href ? '</a>' : '</button>'}
    `).join('');

    const openMenu = (open) => {
      menu.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    };

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      openMenu(menu.hidden);
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!menu.hidden && !menu.contains(e.target) && e.target !== toggle && !toggle.contains(e.target)) {
        openMenu(false);
      }
    });

    // Wire per-item actions (for buttons; href links just open as normal)
    menu.querySelectorAll('[data-idx]').forEach((el) => {
      el.addEventListener('click', async (e) => {
        const idx = parseInt(el.dataset.idx, 10);
        const item = items[idx];
        if (!item) return;
        if (item.action) {
          e.preventDefault();
          const res = await item.action();
          if (hint && res && res.msg) {
            hint.textContent = res.msg;
            hint.classList.toggle('is-error', !res.ok);
            setTimeout(() => { hint.textContent = ''; hint.classList.remove('is-error'); }, 4500);
          }
        }
        openMenu(false);
      });
    });

    // Esc closes the menu
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) openMenu(false);
    });
  }

  /** Safe-ish clipboard write that falls back to a select-based trick. */
  async copyToClipboardSafe(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        return true;
      } catch (_) {
        return false;
      }
    }
  }

  /** Public URL that deep-links to this event's modal on the News page. */
  buildShareUrl(event) {
    const origin = window.location.origin;
    const path = window.location.pathname.replace(/\/[^\/]*$/, '/') + 'news.html';
    // pathname might already BE news.html; handle that too
    const finalPath = path.endsWith('news.html')
      ? path
      : window.location.pathname;
    const id = encodeURIComponent(event.id || '');
    return `${origin}${finalPath}#event=${id}`;
  }

  /** Plain-text announcement ready for Telegram, WhatsApp, IG caption, etc.
   *  Follows the ministry's template:
   *    ❕! TONIGHT 6PM ! ❕
   *    🌱Seed The Word! 🌱
   *    @ <place>!
   *    Address:
   *    📍 <address> (<apple maps>)
   *    Google maps link (<google maps>)
   *    🙏🏻🤍<description>🙏🏻🤍
   *    <extra note, if any>
   *    ✨
   *    Details → <deep link>
   */
  buildShareText(event, shareUrl) {
    const start = this.getEventStart(event);
    const end   = this.getEventEnd(event);
    if (!start) return '';

    const isAllDay = !event.start?.dateTime;
    const title    = (event.summary || 'Seed the Word Event').trim();

    // Banner line — matches team's Telegram template:
    //   ❕! TONIGHT, 10AM ! ❕   (same-day)
    //   ❕! TOMORROW, 7PM ! ❕   (next-day)
    //   ❕! FRIDAY, 7PM ! ❕     (within the week)
    //   ❕! MAY 25, 10AM ! ❕    (further out)
    const now = new Date();
    const startOfDay = d => { const c = new Date(d); c.setHours(0, 0, 0, 0); return c; };
    const dayDiff = Math.round((startOfDay(start) - startOfDay(now)) / 86400000);
    // "7:00 PM" -> "7PM"; "10:30 AM" -> "10:30AM"
    const timeStr = isAllDay
      ? 'ALL DAY'
      : start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
          .replace(':00', '')
          .replace(/\s+/g, '')
          .toUpperCase();
    let banner;
    if (dayDiff === 0)       banner = `TONIGHT, ${timeStr}`;
    else if (dayDiff === 1)  banner = `TOMORROW, ${timeStr}`;
    else if (dayDiff > 1 && dayDiff <= 7) {
      const dayName = start.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
      banner = `${dayName}, ${timeStr}`;
    } else {
      const d = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
      banner = `${d}, ${timeStr}`;
    }

    // Pull "@ <place>!" out of the event title if it already has one,
    // otherwise fall back to the location or title.
    let venueLine = null;
    const atMatch = title.match(/\s@\s(.+)$/i);
    if (atMatch) {
      venueLine = `@ ${atMatch[1].trim()}!`;
    } else if (event.location) {
      // Take the first line / first comma-separated segment of the address
      const firstBit = String(event.location).split(/\r?\n/)[0].split(',')[0].trim();
      if (firstBit) venueLine = `@ ${firstBit}!`;
    }

    // Address block — prefer the event's Location text; fall back to
    // lat/lng coordinates if that's all we have. No maps links — the
    // bare address auto-linkifies in Telegram/IG/most clients, and an
    // honest coordinate pair is more useful than a stale geocoded URL.
    let addressBlock = null;
    if (event.location) {
      const rawAddr = String(event.location).replace(/\s+/g, ' ').trim();
      addressBlock = 'Address:\n\u{1F4CD}' + rawAddr;
    } else {
      const geo = getEventCoords(event);
      if (geo) {
        addressBlock = 'Coordinates:\n\u{1F4CD}' + geo.lat.toFixed(5) + ', ' + geo.lng.toFixed(5);
      }
    }

    // Body: description passes through verbatim (team adds their own
    // 🙏🏻🤍 wrappers or emojis in Google Calendar when they want them).
    let bodyBlock = null;
    if (event.description) {
      const cleanDesc = stripHtmlToText(event.description);
      // Cap at ~800 chars, but don't slice mid-word or mid-emoji
      const capped = smartTrim(cleanDesc, 800);
      if (capped) bodyBlock = '🙏🏻🤍' + capped;
    }

    // Assemble
    const parts = [];
    parts.push(`❕! ${banner} ! ❕`);
    parts.push('🌱Seed The Word! 🌱');
    if (venueLine) parts.push(venueLine);
    if (addressBlock) {
      parts.push('');
      parts.push(addressBlock);
    }
    if (bodyBlock) {
      parts.push('');
      parts.push(bodyBlock);
    }
    parts.push('');
    parts.push('We can\u2019t wait to see you there! \u2728');
    parts.push('');
    parts.push(`More Details (${shareUrl})`);
    return parts.join('\n');
  }

  buildTelegramShareUrl(event, shareUrl) {
    const text = this.buildShareText(event, shareUrl);
    // Telegram's endpoint requires `url=` — without it the share link
    // redirects to telegram.org. We pass the deep link there and strip
    // the 'More Details' footer from the body so it doesn't double-up.
    // A light 'Website' divider sits at the top so the post reads
    // cleanly under Telegram's auto-generated URL preview card.
    const TG_DIVIDER = '━━━━━ 🌐 Website ━━━━━\n\n';
    const telegramBody = TG_DIVIDER + text.replace(/\n?More Details \([^)]*\)\s*$/i, '').trimEnd();
    return `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(telegramBody)}`;
  }
  
  closeModal() {
    const modal = document.getElementById('event-modal');
    if (!modal) return;

    modal.classList.remove('show');
    setTimeout(() => {
      modal.style.display = 'none';
      document.body.style.overflow = '';
    }, 300);

    // Clear the #event= hash so the URL reflects reality
    if (window.location.hash.startsWith('#event=')) {
      try {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      } catch (_) { /* ignore */ }
    }
  }
  
  joinEvent(link) {
    if (link && link !== '#') {
      window.open(link, '_blank');
    }
    this.closeModal();
  }
  
  addToCalendar(dateTime, title) {
    const date = new Date(dateTime);
    const googleCalendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z/${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
    window.open(googleCalendarUrl, '_blank');
    this.closeModal();
  }
  
  bindEvents() {
    // Calendar navigation
    const prevBtn = document.getElementById('prev-month');
    const nextBtn = document.getElementById('next-month');
    const modalClose = document.getElementById('event-modal-close');
    
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        this.currentMonth--;
        if (this.currentMonth < 0) {
          this.currentMonth = 11;
          this.currentYear--;
        }
        this.renderCalendar();
      });
    }
    
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        this.currentMonth++;
        if (this.currentMonth > 11) {
          this.currentMonth = 0;
          this.currentYear++;
        }
        this.renderCalendar();
      });
    }
    
    if (modalClose) {
      modalClose.addEventListener('click', () => this.closeModal());
    }
    
    // Modal backdrop click
    const modal = document.getElementById('event-modal');
    if (modal) {
      modal.querySelector('.event-modal__backdrop')?.addEventListener('click', () => this.closeModal());
    }
    
    // Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal && modal.style.display === 'flex') {
        this.closeModal();
      }
    });
    
    // Auto-refresh events every hour
    setInterval(() => {
      this.loadEvents().then(() => {
        this.renderEventCards();
      });
    }, 60 * 60 * 1000); // 1 hour
  }
  
  // Public methods for manual refresh
  async refresh() {
    try {
      console.log('🔄 Refreshing calendar...');
      await this.loadEvents();
      this.renderCalendar();
      this.renderEventCards();
      console.log('✅ Calendar refreshed successfully');
    } catch (error) {
      console.error('❌ Error refreshing calendar:', error);
      alert('Error refreshing calendar. Please check the console for details.');
    }
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('📅 Initializing Google Calendar Integration...');
  window.googleCalendar = new GoogleCalendarIntegration();
});

// Make refresh function globally available
window.refreshGoogleCalendar = () => {
  console.log('🔄 Refresh button clicked');
  if (window.googleCalendar) {
    window.googleCalendar.refresh();
  } else {
    console.error('❌ Google Calendar not initialized yet');
    alert('Calendar not initialized. Please refresh the page.');
  }
};

// Debug function to see what events are in your Google Calendar
window.debugGoogleCalendarEvents = () => {
  if (window.googleCalendar && window.googleCalendar.events) {
    console.log('🔍 DEBUG: Current events in calendar:', window.googleCalendar.events.length);
    window.googleCalendar.events.forEach((event, index) => {
      const start = window.googleCalendar.getEventStart(event);
      console.log(`${index + 1}. "${event.summary}" - ${start ? start.toLocaleDateString() : 'no date'}`);
    });
    
    alert(`Found ${window.googleCalendar.events.length} events in your Google Calendar.\n\nCheck the browser console (F12) to see the full list of events.\n\nThese are REAL events from your Google Calendar, not fake ones.`);
  } else {
    alert('No calendar data loaded yet. Try refreshing first.');
  }
};