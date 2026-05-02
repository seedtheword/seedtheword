/* ============================================================
   Google Calendar Integration - Single Source of Truth
   ============================================================ */

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
    if (!start || !end) return 'upcoming';
    
    if (start <= now && end >= now) return 'live';
    if (start > now) return 'upcoming';
    return 'ongoing';
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
  
  showEventModal(event, date) {
    const modal = document.getElementById('event-modal');
    const modalBody = document.getElementById('event-modal-body');
    
    if (!modal || !modalBody) return;
    
    const startDate = this.getEventStart(event);
    const endDate = this.getEventEnd(event);
    if (!startDate || !endDate) return;
    
    modalBody.innerHTML = `
      <div class="event-modal__content glass-morphism">
        <h3 class="event-modal__title">${event.summary || event.title}</h3>
        <div class="event-modal__details">
          <p><strong>📅 Date:</strong> ${this.formatEventTime(startDate)}</p>
          <p><strong>⏰ Duration:</strong> ${startDate.toLocaleTimeString()} - ${endDate.toLocaleTimeString()}</p>
          ${event.location ? `<p><strong>📍 Location:</strong> ${event.location}</p>` : ''}
          ${event.description ? `<p><strong>📝 Description:</strong> ${event.description}</p>` : ''}
        </div>
        <div class="event-modal__actions">
          <button class="btn btn-primary glass-morphism" onclick="googleCalendar.joinEvent('${event.htmlLink || '#'}')">
            Join Event
          </button>
          <button class="btn btn-secondary glass-morphism" onclick="googleCalendar.addToCalendar('${startDate.toISOString()}', '${event.summary || event.title}')">
            Add to My Calendar
          </button>
        </div>
      </div>
    `;
    
    modal.style.display = 'flex';
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
  }
  
  closeModal() {
    const modal = document.getElementById('event-modal');
    if (!modal) return;
    
    modal.classList.remove('show');
    setTimeout(() => {
      modal.style.display = 'none';
      document.body.style.overflow = '';
    }, 300);
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