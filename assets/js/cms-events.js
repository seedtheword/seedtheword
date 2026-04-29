/* ============================================================
   CMS Events Integration - Simple & Reliable
   ============================================================ */

// Simple event storage that gets updated when you add events
window.cmsEvents = [
  // Events from CMS
  {
    title: "Youth Outreach",
    date: new Date("2026-05-02T18:00:00Z"),
    type: "upcoming",
    description: "Connecting with local youth to share the Gospel and build lasting relationships in Christ.",
    button_text: "Get Involved",
    button_link: "about.html#contact"
  },
  {
    title: "Study Saturday Live", 
    date: new Date("2026-05-03T14:00:00Z"),
    type: "live",
    description: "Join our weekly livestream for Bible study, fellowship, and prayer with members worldwide.",
    button_text: "Watch Live",
    button_link: "community.html"
  }
];

// Function to add a new event (call this after creating events in CMS)
function addCMSEvent(eventData) {
  window.cmsEvents.push(eventData);
  
  // Update calendar if it exists
  if (window.ministryCalendar) {
    window.ministryCalendar.addCMSEvent(eventData);
  }
  
  // Update announcements if on news page
  if (window.location.pathname.includes('news.html')) {
    updateAnnouncementsWithEvent(eventData);
  }
}

// Function to manually add your test event
function addTestEvent() {
  const testEvent = {
    title: "Test Event #5",
    date: new Date("2026-04-29T11:25:00"),
    type: "live",
    description: "This is a test event created from the admin panel",
    button_text: "Link to Bible.com lol",
    button_link: "https://www.bible.com"
  };
  
  addCMSEvent(testEvent);
  
  // Show success message
  alert("Test event added to calendar! Check April 29, 2026");
  
  // Also add to the global cms events array
  window.cmsEvents.push(testEvent);
}

// Function to load CMS events into calendar
function loadCMSEventsIntoCalendar() {
  console.log('loadCMSEventsIntoCalendar called');
  console.log('window.ministryCalendar:', window.ministryCalendar);
  console.log('window.cmsEvents:', window.cmsEvents);
  
  if (window.ministryCalendar && window.cmsEvents) {
    console.log('Loading', window.cmsEvents.length, 'CMS events into calendar');
    window.cmsEvents.forEach((event, index) => {
      console.log('Adding event', index + 1, ':', event.title, 'on', event.date);
      window.ministryCalendar.addCMSEvent(event);
    });
    console.log('All CMS events loaded successfully');
  } else {
    console.log('Calendar or CMS events not available yet');
  }
}

// Function to debug calendar events
function debugCalendarEvents() {
  if (window.ministryCalendar) {
    console.log('Calendar events:', window.ministryCalendar.events);
    console.log('Special events:', window.ministryCalendar.events.special);
    
    // Check for April 29, 2026 specifically
    const april29 = '2026-04-29';
    if (window.ministryCalendar.events.special[april29]) {
      console.log('Events on April 29, 2026:', window.ministryCalendar.events.special[april29]);
    } else {
      console.log('No events found for April 29, 2026');
    }
    
    // Check for May 2026 events
    Object.keys(window.ministryCalendar.events.special).forEach(dateKey => {
      if (dateKey.startsWith('2026-05')) {
        console.log('May 2026 event:', dateKey, window.ministryCalendar.events.special[dateKey]);
      }
    });
  } else {
    console.log('Calendar not initialized yet');
  }
}

// Auto-load CMS events when calendar is ready
document.addEventListener('DOMContentLoaded', () => {
  // Wait a bit for calendar to initialize
  setTimeout(loadCMSEventsIntoCalendar, 1000);
  
  // Add debug function after a longer delay
  setTimeout(() => {
    console.log('=== CALENDAR DEBUG INFO ===');
    debugCalendarEvents();
  }, 3000);
});

// Make functions globally available
window.addCMSEvent = addCMSEvent;
window.addTestEvent = addTestEvent;
window.loadCMSEventsIntoCalendar = loadCMSEventsIntoCalendar;
window.debugCalendarEvents = debugCalendarEvents;