/* ============================================================
   Google Calendar Integration with Glass Morphism
   ============================================================ */

class GoogleCalendarIntegration {
  constructor() {
    // Your actual Google Calendar API credentials
    this.apiKey = 'AIzaSyA6GMEdyQHxcRCJuun-OIrFlJgG67Zjtpc';
    this.calendarId = 'seedthewordministry@gmail.com';
    
    // Fallback events (in case API is unavailable)
    this.fallbackEvents = [
      {
        title: 'Daily Bible Reading',
        start: { dateTime: '2026-04-29T09:00:00-08:00' },
        end: { dateTime: '2026-04-29T09:30:00-08:00' },
        description: 'Journey through the New Testament with our community',
        location: 'Online - Telegram Group',
        recurring: 'RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR'
      },
      {
        title: 'Study Saturday Live',
        start: { dateTime: '2026-05-03T14:00:00-08:00' },
        end: { dateTime: '2026-05-03T16:00:00-08:00' },
        description: 'Weekly livestream for Bible study, fellowship, and prayer',
        location: 'Twitch/YouTube Live',
        recurring: 'RRULE:FREQ=WEEKLY;BYDAY=SA'
      },
      {
        title: 'Youth Outreach',
        start: { dateTime: '2026-05-02T18:00:00-08:00' },
        end: { dateTime: '2026-05-02T20:00:00-08:00' },
        description: 'Connecting with local youth to share the Gospel',
        location: 'Community Centers',
        recurring: 'RRULE:FREQ=WEEKLY;BYDAY=FR'
      },
      {
        title: 'Sunday Worship',
        start: { dateTime: '2026-04-27T10:00:00-08:00' },
        end: { dateTime: '2026-04-27T12:00:00-08:00' },
        description: 'Come to church and devote this holy day to God',
        location: 'Local Church',
        recurring: 'RRULE:FREQ=WEEKLY;BYDAY=SU'
      },
      {
        title: 'Life Group Fellowship',
        start: { dateTime: '2026-04-29T19:00:00-08:00' },
        end: { dateTime: '2026-04-29T21:00:00-08:00' },
        description: 'Small groups for deeper fellowship and study',
        location: 'Various Locations',
        recurring: 'RRULE:FREQ=WEEKLY;BYDAY=TU'
      }
    ];
    
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
      
      // Try to load from Google Calendar API
      if (this.apiKey !== 'YOUR_GOOGLE_API_KEY_HERE') {
        const events = await this.fetchGoogleCalendarEvents();
        if (events && events.length > 0) {
          this.events = events;
          console.log('✅ Successfully loaded', events.length, 'events from Google Calendar');
          return;
        } else {
          console.log('📭 No events found in Google Calendar, using fallback events');
        }
      }
      
      // Fallback to local events
      this.events = this.generateRecurringEvents(this.fallbackEvents);
      console.log('📅 Using fallback events (', this.events.length, 'events generated)');
      
    } catch (error) {
      console.error('⚠️ Google Calendar API Error:', error.message);
      console.log('📅 Falling back to local events');
      this.events = this.generateRecurringEvents(this.fallbackEvents);
    }
  }
  
  async fetchGoogleCalendarEvents() {
    const timeMin = new Date();
    timeMin.setMonth(timeMin.getMonth() - 1); // Get events from last month
    const timeMax = new Date();
    timeMax.setMonth(timeMax.getMonth() + 6); // Get events for next 6 months
    
    // Use CORS proxy for testing if direct API fails
    const directUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events?` +
      `key=${this.apiKey}&` +
      `timeMin=${timeMin.toISOString()}&` +
      `timeMax=${timeMax.toISOString()}&` +
      `singleEvents=true&` +
      `orderBy=startTime&` +
      `maxResults=100`;
    
    console.log('🔗 Fetching from Google Calendar API:', this.calendarId);
    console.log('🔗 API URL:', directUrl);
    
    try {
      const response = await fetch(directUrl);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Google Calendar API Error:', response.status, response.statusText);
        console.error('❌ Error details:', errorText);
        
        // Try to parse error for more details
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error) {
            throw new Error(`${errorData.error.message} (${errorData.error.code})`);
          }
        } catch (parseError) {
          // If we can't parse the error, use the status
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      }
      
      const data = await response.json();
      console.log('✅ Google Calendar API Success:', data.items?.length || 0, 'events loaded');
      return data.items || [];
      
    } catch (fetchError) {
      console.error('❌ Fetch Error:', fetchError.message);
      
      // Provide specific error messages for common issues
      if (fetchError.message.includes('CORS')) {
        throw new Error('CORS Error: API key may need domain restrictions updated');
      } else if (fetchError.message.includes('403')) {
        throw new Error('Permission denied: Check API key and calendar permissions');
      } else if (fetchError.message.includes('404')) {
        throw new Error('Calendar not found: Check calendar ID and visibility settings');
      } else if (fetchError.message.includes('400')) {
        throw new Error('Bad request: Check API key format and parameters');
      } else {
        throw fetchError;
      }
    }
  }
  
  generateRecurringEvents(baseEvents) {
    const events = [];
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 1);
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 6);
    
    baseEvents.forEach(baseEvent => {
      if (baseEvent.recurring) {
        // Generate recurring events for the next 6 months
        const eventStart = new Date(baseEvent.start.dateTime);
        const current = new Date(startDate);
        
        while (current <= endDate) {
          const dayOfWeek = current.getDay();
          const eventDayOfWeek = eventStart.getDay();
          
          if (dayOfWeek === eventDayOfWeek) {
            const newEvent = {
              ...baseEvent,
              start: {
                dateTime: new Date(current.getFullYear(), current.getMonth(), current.getDate(), 
                         eventStart.getHours(), eventStart.getMinutes()).toISOString()
              },
              end: {
                dateTime: new Date(current.getFullYear(), current.getMonth(), current.getDate(), 
                         eventStart.getHours() + 2, eventStart.getMinutes()).toISOString()
              }
            };
            events.push(newEvent);
          }
          current.setDate(current.getDate() + 1);
        }
      } else {
        events.push(baseEvent);
      }
    });
    
    return events.sort((a, b) => new Date(a.start.dateTime) - new Date(b.start.dateTime));
  }
  
  renderCalendar() {
    const calendarGrid = document.getElementById('calendar-grid');
    const monthDisplay = document.getElementById('calendar-month');
    
    if (!calendarGrid || !monthDisplay) return;
    
    // Update month display
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    monthDisplay.textContent = `${monthNames[this.currentMonth]} ${this.currentYear}`;
    
    // Clear calendar
    calendarGrid.innerHTML = '';
    
    // Add day headers with glass morphism
    const dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    dayHeaders.forEach(day => {
      const header = document.createElement('div');
      header.className = 'calendar-day-header glass-morphism';
      header.textContent = day;
      calendarGrid.appendChild(header);
    });
    
    // Get first day of month and number of days
    const firstDay = new Date(this.currentYear, this.currentMonth, 1);
    const lastDay = new Date(this.currentYear, this.currentMonth + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();
    
    // Add empty cells for days before month starts
    for (let i = 0; i < startingDayOfWeek; i++) {
      const prevMonthDay = new Date(this.currentYear, this.currentMonth, 0 - (startingDayOfWeek - 1 - i));
      const dayCell = this.createDayCell(prevMonthDay.getDate(), true);
      calendarGrid.appendChild(dayCell);
    }
    
    // Add days of current month
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(this.currentYear, this.currentMonth, day);
      const dayCell = this.createDayCell(day, false, date);
      calendarGrid.appendChild(dayCell);
    }
    
    // Add empty cells for days after month ends
    const totalCells = calendarGrid.children.length - 7; // Subtract headers
    const remainingCells = 42 - totalCells; // 6 rows × 7 days = 42 cells
    for (let i = 1; i <= remainingCells; i++) {
      const dayCell = this.createDayCell(i, true);
      calendarGrid.appendChild(dayCell);
    }
  }
  
  createDayCell(dayNumber, isOtherMonth = false, date = null) {
    const dayCell = document.createElement('div');
    dayCell.className = 'calendar-day glass-morphism';
    
    if (isOtherMonth) {
      dayCell.classList.add('other-month');
    }
    
    // Check if this is today
    if (date && this.isToday(date)) {
      dayCell.classList.add('today');
    }
    
    // Add day number
    const dayNumberEl = document.createElement('div');
    dayNumberEl.className = 'calendar-day-number';
    dayNumberEl.textContent = dayNumber;
    dayCell.appendChild(dayNumberEl);
    
    // Add events for this day
    if (date && !isOtherMonth) {
      const dayEvents = this.getEventsForDate(date);
      dayEvents.forEach(event => {
        const eventEl = document.createElement('div');
        eventEl.className = `calendar-event ${this.getEventType(event)} glass-morphism-subtle`;
        eventEl.textContent = this.truncateText(event.summary || event.title, 15);
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
    this.renderUpcomingEvents();
    this.renderLiveEvents();
  }
  
  renderUpcomingEvents() {
    const container = document.getElementById('upcoming-events-container');
    if (!container) return;
    
    const now = new Date();
    const upcomingEvents = this.events
      .filter(event => new Date(event.start.dateTime) > now)
      .slice(0, 6);
    
    container.innerHTML = upcomingEvents.map(event => {
      const startDate = new Date(event.start.dateTime);
      const eventType = this.getEventType(event);
      
      return `
        <div class="event-card glass-morphism ${eventType}" onclick="googleCalendar.showEventModal(${JSON.stringify(event).replace(/"/g, '&quot;')}, '${startDate.toISOString()}')">
          <div class="event-card__status">${this.getEventStatusIcon(eventType)} ${this.getEventStatusText(eventType)}</div>
          <div class="event-card__content">
            <h4 class="event-card__title">${event.summary || event.title}</h4>
            <p class="event-card__time">${this.formatEventTime(startDate)}</p>
            <p class="event-card__description">${this.truncateText(event.description || '', 100)}</p>
            <div class="event-card__location">${event.location || ''}</div>
          </div>
          <div class="event-card__hover-effect"></div>
        </div>
      `;
    }).join('');
  }
  
  renderLiveEvents() {
    const container = document.getElementById('live-events-container');
    if (!container) return;
    
    const now = new Date();
    const liveEvents = this.events.filter(event => {
      const start = new Date(event.start.dateTime);
      const end = new Date(event.end.dateTime);
      return start <= now && end >= now;
    });
    
    if (liveEvents.length === 0) {
      container.innerHTML = `
        <div class="event-card glass-morphism offline">
          <div class="event-card__status">⏰ NEXT UP</div>
          <div class="event-card__content">
            <h4 class="event-card__title">Study Saturday Live</h4>
            <p class="event-card__time">Saturdays • 2:00 PM PST</p>
            <p class="event-card__description">Join our weekly livestream for Bible study, fellowship, and prayer with members worldwide.</p>
          </div>
        </div>
      `;
      return;
    }
    
    container.innerHTML = liveEvents.map(event => `
      <div class="event-card glass-morphism live">
        <div class="event-card__status">🔴 LIVE NOW</div>
        <div class="event-card__content">
          <h4 class="event-card__title">${event.summary || event.title}</h4>
          <p class="event-card__time">Started ${this.formatEventTime(new Date(event.start.dateTime))}</p>
          <p class="event-card__description">${event.description || ''}</p>
        </div>
        <div class="live-pulse"></div>
      </div>
    `).join('');
  }
  
  // Utility methods
  getEventType(event) {
    const now = new Date();
    const start = new Date(event.start.dateTime);
    const end = new Date(event.end.dateTime);
    
    if (start <= now && end >= now) return 'live';
    if (start > now) return 'upcoming';
    return 'ongoing';
  }
  
  getEventStatusIcon(type) {
    const icons = {
      live: '🔴',
      upcoming: '📅',
      ongoing: '🔄'
    };
    return icons[type] || '📅';
  }
  
  getEventStatusText(type) {
    const texts = {
      live: 'LIVE NOW',
      upcoming: 'UPCOMING',
      ongoing: 'ONGOING'
    };
    return texts[type] || 'EVENT';
  }
  
  formatEventTime(date) {
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
    const dateStr = date.toISOString().split('T')[0];
    return this.events.filter(event => {
      const eventDate = new Date(event.start.dateTime).toISOString().split('T')[0];
      return eventDate === dateStr;
    });
  }
  
  showEventModal(event, date) {
    const modal = document.getElementById('event-modal');
    const modalBody = document.getElementById('event-modal-body');
    
    if (!modal || !modalBody) return;
    
    const startDate = new Date(event.start.dateTime);
    const endDate = new Date(event.end.dateTime);
    
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
          <button class="btn btn-secondary glass-morphism" onclick="googleCalendar.addToCalendar('${event.start.dateTime}', '${event.summary || event.title}')">
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
    await this.loadEvents();
    this.renderCalendar();
    this.renderEventCards();
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.googleCalendar = new GoogleCalendarIntegration();
});

// Make refresh function globally available
window.refreshGoogleCalendar = () => {
  if (window.googleCalendar) {
    window.googleCalendar.refresh();
  }
};

// Test function for debugging
window.testGoogleCalendarAPI = async () => {
  console.log('🧪 Testing Google Calendar API...');
  
  const apiKey = 'AIzaSyA6GMEdyQHxcRCJuun-OIrFlJgG67Zjtpc';
  const calendarId = 'seedthewordministry@gmail.com';
  
  const timeMin = new Date();
  timeMin.setDate(timeMin.getDate() - 30);
  const timeMax = new Date();
  timeMax.setDate(timeMax.getDate() + 180);
  
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?` +
    `key=${apiKey}&` +
    `timeMin=${timeMin.toISOString()}&` +
    `timeMax=${timeMax.toISOString()}&` +
    `singleEvents=true&` +
    `orderBy=startTime&` +
    `maxResults=10`;
  
  console.log('🔗 Testing URL:', url);
  
  try {
    const response = await fetch(url);
    console.log('📡 Response status:', response.status, response.statusText);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Error response:', errorText);
      alert(`API Test Failed: ${response.status} ${response.statusText}\n\nCheck console for details.`);
      return;
    }
    
    const data = await response.json();
    console.log('✅ API Test Success!', data);
    console.log('📅 Events found:', data.items?.length || 0);
    
    if (data.items && data.items.length > 0) {
      console.log('📋 Sample events:', data.items.slice(0, 3));
      alert(`✅ API Test Success!\n\nFound ${data.items.length} events in your calendar.\n\nCheck console for details.`);
    } else {
      alert(`✅ API Connected Successfully!\n\nNo events found in your calendar.\nTry adding some events in Google Calendar.`);
    }
    
  } catch (error) {
    console.error('❌ API Test Failed:', error);
    alert(`❌ API Test Failed: ${error.message}\n\nCheck console for details.`);
  }
};