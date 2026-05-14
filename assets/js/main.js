/* ============================================================
   Ministry Website — main.js
   ============================================================ */

// ── Mobile nav toggle ──────────────────────────────────────
const toggle = document.getElementById('nav-toggle');
const nav    = document.getElementById('site-nav');
const header = document.getElementById('site-header');

if (toggle && nav) {
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open);
  });
  document.addEventListener('click', e => {
    if (!nav.contains(e.target) && !toggle.contains(e.target)) {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.focus();
    }
  });
  nav.addEventListener('click', e => {
    if (e.target.tagName === 'A') {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
}

// ── Sticky header shadow ───────────────────────────────────
if (header) {
  window.addEventListener('scroll', () => {
    header.classList.toggle('scrolled', window.scrollY > 10);
  }, { passive: true });
}

// ── Active nav link ────────────────────────────────────────
document.querySelectorAll('.nav-links a').forEach(a => {
  if (a.href === location.href) a.classList.add('active');
});

// ── Accordion toggle ───────────────────────────────────────
document.querySelectorAll('.accordion-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', !expanded);
    const body = document.getElementById(btn.getAttribute('aria-controls'));
    if (body) body.hidden = expanded;
  });
});

// ── Bundle Builder: price calculator ──────────────────────
const priceDisplay   = document.getElementById('price-display');
const bundleNameEl   = document.getElementById('summary-bundle-name');
const addonsListEl   = document.getElementById('summary-addons-list');

function calcPrice() {
  if (!priceDisplay) return;
  const radio = document.querySelector('input[name="bundle"]:checked');
  const base  = radio ? parseFloat(radio.dataset.price || 2) : 2;
  let addonsTotal = 0;
  const addonLines = [];

  document.querySelectorAll('.addon-pill.on').forEach(pill => {
    const p = parseFloat(pill.dataset.price || 0);
    addonsTotal += p;
    addonLines.push({ label: pill.dataset.label, price: p });
  });

  const total = Math.max(2, base + addonsTotal);
  priceDisplay.textContent = '$' + total.toFixed(2);

  if (bundleNameEl) {
    bundleNameEl.textContent = radio
      ? (radio.dataset.name || radio.value)
      : 'No bundle selected';
    bundleNameEl.style.fontStyle = radio ? 'normal' : 'italic';
    bundleNameEl.style.color     = radio ? '#2c1a0e' : '#aaa';
  }

  if (addonsListEl) {
    addonsListEl.innerHTML = addonLines.length
      ? addonLines.map(a =>
          `<div style="display:flex;justify-content:space-between;padding:.2rem 0">
            <span>${a.label}</span>
            <span style="color:var(--gold);font-weight:600">+$${a.price.toFixed(2)}</span>
          </div>`).join('')
      : '<span style="color:#aaa;font-style:italic">No add-ons selected</span>';
  }
}

// Wire bundle radios
document.querySelectorAll('input[name="bundle"]').forEach(r => r.addEventListener('change', calcPrice));

// Wire addon pills
document.querySelectorAll('.addon-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    pill.classList.toggle('on');
    calcPrice();
  });
});

// Initial calc
calcPrice();

// ── Donation request panel ─────────────────────────────────
const donateBtn   = document.getElementById('btn-request-donation');
const donatePanel = document.getElementById('donation-panel');
const donateClose = document.getElementById('donation-panel-close');

if (donateBtn && donatePanel) {
  donateBtn.addEventListener('click', () => {
    donatePanel.hidden = false;
    donatePanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
if (donateClose && donatePanel) {
  donateClose.addEventListener('click', () => {
    donatePanel.hidden = true;
    if (donateBtn) donateBtn.focus();
  });
}

// ── Order summary modal ────────────────────────────────────
const completeBtn   = document.getElementById('btn-complete-gift');
const modal         = document.getElementById('order-modal');
const modalClose    = document.getElementById('modal-close');
const modalBack     = document.getElementById('modal-back');
const modalConfirm  = document.getElementById('modal-confirm');
const modalContent  = document.getElementById('modal-content');
const bundleErrEl   = document.getElementById('bundle-error');

function openModal() {
  if (!modal) return;
  modal.hidden = false;
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  modal.querySelector('button').focus();
}
function closeModal() {
  if (!modal) return;
  modal.hidden = true;
  modal.style.display = 'none';
  document.body.style.overflow = '';
  if (completeBtn) completeBtn.focus();
}

if (completeBtn) {
  completeBtn.addEventListener('click', () => {
    const radio = document.querySelector('input[name="bundle"]:checked');
    if (!radio) {
      if (bundleErrEl) { bundleErrEl.style.display = 'block'; bundleErrEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      return;
    }
    if (bundleErrEl) bundleErrEl.style.display = 'none';
    if (modalContent) {
      const bundleName = radio.dataset.name || radio.value;
      const total = priceDisplay ? priceDisplay.textContent : '$2.00';
      const addonLines = [...document.querySelectorAll('.addon-pill.on')]
        .map(p => `<li>${p.dataset.label} — +$${parseFloat(p.dataset.price).toFixed(2)}</li>`).join('');
      modalContent.innerHTML = `
        <p><strong>Bundle:</strong> ${bundleName}</p>
        ${addonLines ? `<p><strong>Add-ons:</strong></p><ul style="list-style:disc;padding-left:1.25rem;margin:.5rem 0 1rem">${addonLines}</ul>` : '<p style="color:#aaa;font-style:italic">No add-ons selected</p>'}
        <p style="font-size:1.25rem;font-weight:800;color:var(--gold)">Total: ${total}</p>`;
    }
    openModal();
  });
}
if (modalClose)   modalClose.addEventListener('click', closeModal);
if (modalBack)    modalBack.addEventListener('click', closeModal);
if (modal) {
  modal.querySelector('.modal-backdrop')?.addEventListener('click', closeModal);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });
}
if (modalConfirm) {
  modalConfirm.addEventListener('click', () => {
    alert('In the live site this proceeds to checkout. Backend integration coming soon.');
    closeModal();
  });
}

// ── Testimonies: read more toggle ─────────────────────────
document.querySelectorAll('.testimony-card__more').forEach(btn => {
  btn.addEventListener('click', () => {
    const card = btn.closest('.testimony-card');
    const textEl = card?.querySelector('.testimony-card__text');
    if (!textEl) return;
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    if (expanded) {
      textEl.textContent = textEl.dataset.excerpt;
      btn.textContent = 'Read More';
      btn.setAttribute('aria-expanded', 'false');
    } else {
      if (!textEl.dataset.excerpt) textEl.dataset.excerpt = textEl.textContent;
      textEl.textContent = textEl.dataset.full || textEl.textContent;
      btn.textContent = 'Show Less';
      btn.setAttribute('aria-expanded', 'true');
    }
  });
});

// ── Contact form (Apps Script primary, Formspree fallback) ────
const contactForm = document.getElementById('contact-form');
if (contactForm) {
  // Cache the site config (orderHandlerUrl is reused for the contact form too).
  let _siteConfigPromise = null;
  function loadContactSiteConfig() {
    if (!_siteConfigPromise) {
      _siteConfigPromise = fetch('assets/data/site-config.json?v=1', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : { orderHandlerUrl: '' })
        .catch(() => ({ orderHandlerUrl: '' }));
    }
    return _siteConfigPromise;
  }

  function isUsableHandlerUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (!/^https:\/\//i.test(url)) return false;
    return /script\.google\.com\/macros\//i.test(url) || /googleusercontent\.com\//i.test(url);
  }

  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name    = contactForm.querySelector('[name="name"]').value.trim();
    const email   = contactForm.querySelector('[name="email"]').value.trim();
    const subject = (contactForm.querySelector('[name="subject"]')?.value || '').trim();
    const msg     = contactForm.querySelector('[name="message"]').value.trim();
    const errEl = document.getElementById('contact-errors');
    const successEl = document.getElementById('contact-success');
    const submitBtn = contactForm.querySelector('button[type="submit"]');

    // Validate
    const errors = [];
    if (!name)  errors.push('Your name is required.');
    if (!email || !email.includes('@')) errors.push('A valid email address is required.');
    if (!msg)   errors.push('A message is required.');
    if (errors.length) {
      if (errEl) {
        errEl.style.display = 'block';
        errEl.innerHTML = errors.map(x => '• ' + x).join('<br>');
      }
      return;
    }
    if (errEl) errEl.style.display = 'none';

    const originalLabel = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';
    }

    const cfg = await loadContactSiteConfig();
    const handlerUrl = cfg && cfg.orderHandlerUrl;

    // Path A: Apps Script (preferred)
    if (isUsableHandlerUrl(handlerUrl)) {
      try {
        const res = await fetch(handlerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            type: 'contact',
            name, email, subject, message: msg,
            source: 'about-contact',
            submittedAt: new Date().toISOString(),
          }),
        });
        if (!res.ok) throw new Error('http ' + res.status);
        const json = await res.json();
        if (!json || json.ok !== true) throw new Error(json && json.error || 'unknown');
        contactForm.style.display = 'none';
        if (successEl) successEl.style.display = 'block';
        return;
      } catch (err) {
        // fall through to Formspree
        console.log('Apps Script contact path failed, falling back:', err);
      }
    }

    // Path B: Formspree fallback
    const endpoint = contactForm.getAttribute('action') || '';
    if (!endpoint || endpoint.includes('YOUR_FORMSPREE_ENDPOINT')) {
      if (errEl) {
        errEl.style.display = 'block';
        errEl.textContent = "Couldn't reach our inbox right now. Please try again, or reach us on Telegram or Instagram.";
      }
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalLabel; }
      return;
    }
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: new FormData(contactForm),
      });
      if (res.ok) {
        contactForm.style.display = 'none';
        if (successEl) successEl.style.display = 'block';
      } else {
        let msgText = 'Something went wrong sending your message.';
        try {
          const data = await res.json();
          if (data?.errors?.length) {
            msgText = data.errors.map(x => x.message).join(' ');
          }
        } catch (_) {}
        if (errEl) {
          errEl.style.display = 'block';
          errEl.textContent = msgText + ' Please try again, or reach us on Telegram.';
        }
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalLabel;
        }
      }
    } catch (err) {
      if (errEl) {
        errEl.style.display = 'block';
        errEl.textContent = "Couldn't send right now. Check your connection or reach us on Telegram.";
      }
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      }
    }
  });
}

// ── Donate: amount buttons ─────────────────────────────────
document.querySelectorAll('.donate-amount-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.donate-amount-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const input = document.getElementById('donate-custom');
    if (input) input.value = btn.dataset.amount;
    const label = document.getElementById('donate-btn-label');
    if (label) label.textContent = btn.dataset.amount;
  });
});
const donateCustom = document.getElementById('donate-custom');
if (donateCustom) {
  donateCustom.addEventListener('input', () => {
    const label = document.getElementById('donate-btn-label');
    if (label) label.textContent = donateCustom.value || '?';
  });
}
const donateSubmit = document.getElementById('donate-submit');
if (donateSubmit) {
  donateSubmit.addEventListener('click', () => {
    donateSubmit.style.display = 'none';
    document.getElementById('donate-success').style.display = 'block';
    // TODO: integrate with Stripe / GiveWP / payment processor
  });
}

// ── Daily Content Banner with Bible API Integration ─────────────────────────────────────
const dailyContent = {
  verses: [
    { text: "For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.", ref: "John 3:16" },
    { text: "Trust in the LORD with all your heart and lean not on your own understanding; in all your ways submit to him, and he will make your paths straight.", ref: "Proverbs 3:5-6" },
    { text: "I can do all this through him who gives me strength.", ref: "Philippians 4:13" },
    { text: "The LORD is my shepherd, I lack nothing. He makes me lie down in green pastures, he leads me beside quiet waters, he refreshes my soul.", ref: "Psalm 23:1-3" },
    { text: "And we know that in all things God works for the good of those who love him, who have been called according to his purpose.", ref: "Romans 8:28" },
    { text: "Be strong and courageous. Do not be afraid; do not be discouraged, for the LORD your God will be with you wherever you go.", ref: "Joshua 1:9" },
    { text: "In the beginning was the Word, and the Word was with God, and the Word was God.", ref: "John 1:1" },
    { text: "Therefore go and make disciples of all nations, baptizing them in the name of the Father and of the Son and of the Holy Spirit.", ref: "Matthew 28:19" },
    { text: "I planted the seed, Apollos watered it, but God has been making it grow.", ref: "1 Corinthians 3:6" },
    { text: "Let us not become weary in doing good, for at the proper time we will reap a harvest if we do not give up.", ref: "Galatians 6:9" }
  ],
  
  tips: [
    { text: "Start your day with just 5 minutes of Bible reading. Consistency matters more than duration.", ref: "Daily Habit Tip" },
    { text: "When gifting a Bible, include a handwritten note with your favorite verse. Personal touches make all the difference.", ref: "Gifting Tip" },
    { text: "Join our Telegram community for daily encouragement and prayer requests from fellow believers.", ref: "Community Tip" },
    { text: "Highlight verses that speak to you. Your Bible should become a personal conversation with God.", ref: "Study Tip" },
    { text: "Consider sponsoring a Bible bundle for someone who can't afford one. Every gift plants a seed.", ref: "Ministry Tip" },
    { text: "Read the same passage in different translations to gain deeper understanding.", ref: "Study Tip" },
    { text: "Keep a prayer journal alongside your Bible reading. Write down what God is teaching you.", ref: "Growth Tip" },
    { text: "Share your favorite verses on social media. You never know who needs to hear God's word today.", ref: "Outreach Tip" }
  ],
  
  howItWorks: [
    { text: "Every Bible bundle starts at just $2, making God's Word accessible to everyone regardless of financial situation.", ref: "How It Works" },
    { text: "Our ministry covers the cost for those who request donation-funded bundles. No one is turned away.", ref: "How It Works" },
    { text: "Each Bible can be personalized with engraving, highlighted verses, and handwritten notes.", ref: "How It Works" },
    { text: "We ship worldwide and follow up personally with recipients to offer ongoing support.", ref: "How It Works" },
    { text: "Community donations fund our ministry. 100% of gifts go directly toward Bible bundles and shipping.", ref: "How It Works" },
    { text: "Our volunteers pray over each bundle before it's shipped, asking God to use it mightily.", ref: "How It Works" }
  ],
  
  funFacts: [
    { text: "The Bible has been translated into over 3,400 languages, making it the most translated book in history.", ref: "Fun Fact" },
    { text: "Our ministry has shipped Bible bundles to over 50 countries since we started.", ref: "Ministry Fact" },
    { text: "The shortest verse in the Bible is 'Jesus wept' (John 11:35), showing His deep compassion.", ref: "Fun Fact" },
    { text: "Every day, our Telegram community shares over 100 prayer requests and testimonies.", ref: "Community Fact" },
    { text: "The Bible contains 783,137 words in the King James Version.", ref: "Fun Fact" },
    { text: "Our most requested Bible bundle is the 'Essentials Welcome Bundle' for new believers.", ref: "Ministry Fact" },
    { text: "The Bible was written by approximately 40 authors over a span of 1,500 years.", ref: "Fun Fact" }
  ],
  
  haveYouTried: [
    { text: "Reading the Bible chronologically? Start with Genesis and experience God's story from beginning to end.", ref: "Have You Tried?" },
    { text: "Memorizing one verse per week? Small steps lead to big spiritual growth.", ref: "Have You Tried?" },
    { text: "Reading Psalms when you're anxious? David's words bring comfort in difficult times.", ref: "Have You Tried?" },
    { text: "Joining our Saturday study sessions? We review the week's readings and discuss insights together.", ref: "Have You Tried?" },
    { text: "Gifting a Bible to someone going through a tough time? It's a powerful way to show you care.", ref: "Have You Tried?" },
    { text: "Reading Proverbs for daily wisdom? There are 31 chapters - perfect for one per day each month.", ref: "Have You Tried?" },
    { text: "Listening to the Bible while commuting? Audio versions make it easy to stay in God's Word.", ref: "Have You Tried?" }
  ],
  
  encouragement: [
    { text: "God is writing your story, and every chapter has purpose. Trust His timing and His plan.", ref: "Daily Encouragement" },
    { text: "You are fearfully and wonderfully made. Never forget your worth in God's eyes.", ref: "Daily Encouragement" },
    { text: "Every small act of faith matters. God sees your heart and honors your obedience.", ref: "Daily Encouragement" },
    { text: "When you feel alone, remember: God is always with you, and so is our community.", ref: "Daily Encouragement" },
    { text: "Your prayers are powerful. Never underestimate what God can do through a faithful heart.", ref: "Daily Encouragement" },
    { text: "God's grace is new every morning. Yesterday's mistakes don't define today's possibilities.", ref: "Daily Encouragement" },
    { text: "You are called to make a difference. Your life has purpose and eternal significance.", ref: "Daily Encouragement" }
  ],
  
  communityActivity: [
    // Removed - will be replaced with live Telegram feed or removed entirely
  ]
};

// Popular Bible verses for random API fetching
const popularVerses = [
  'john 3:16', 'romans 8:28', 'philippians 4:13', 'psalm 23:1-3', 'proverbs 3:5-6',
  'jeremiah 29:11', 'matthew 28:19', 'isaiah 41:10', 'joshua 1:9', 'romans 12:2',
  'ephesians 2:8-9', '1 corinthians 13:4-7', 'galatians 5:22-23', 'james 1:2-4',
  'psalm 46:1', 'matthew 6:33', 'john 14:6', 'romans 5:8', '2 timothy 1:7'
];

function getDayOfYear() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now - start;
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

function getContentTypeForDay() {
  const day = getDayOfYear();
  // Removed communityActivity from rotation since we don't have live feed yet
  const types = ['verses', 'tips', 'howItWorks', 'funFacts', 'haveYouTried', 'encouragement'];
  return types[day % types.length];
}

function getContentLabel(type) {
  const labels = {
    verses: "Today's Verse",
    tips: "Daily Tip",
    howItWorks: "How It Works",
    funFacts: "Did You Know?",
    haveYouTried: "Have You Tried?",
    encouragement: "Daily Encouragement",
    communityActivity: "Community Activity"
  };
  return labels[type] || "Today's Content";
}

// Fetch verse from Bible API
async function fetchBibleVerse() {
  try {
    // Check cache first (24 hour cache)
    const cached = localStorage.getItem('dailyVerse');
    const cacheTime = localStorage.getItem('dailyVerseTime');
    const now = Date.now();
    
    if (cached && cacheTime && (now - parseInt(cacheTime)) < 24 * 60 * 60 * 1000) {
      return JSON.parse(cached);
    }
    
    // Fetch from API - use a random popular verse
    const verseRef = popularVerses[getDayOfYear() % popularVerses.length];
    const response = await fetch(`https://bible-api.com/${verseRef}?translation=kjv`);
    
    if (!response.ok) throw new Error('API request failed');
    
    const data = await response.json();
    
    const verse = {
      text: data.text.trim().replace(/\s+/g, ' '),
      ref: data.reference
    };
    
    // Cache the result
    localStorage.setItem('dailyVerse', JSON.stringify(verse));
    localStorage.setItem('dailyVerseTime', now.toString());
    
    return verse;
  } catch (error) {
    console.log('Bible API unavailable, using fallback content');
    return null;
  }
}

async function loadDailyContent(random = false) {
  const contentLabel = document.getElementById('content-label');
  const contentText = document.getElementById('content-text');
  const contentRef = document.getElementById('content-ref');
  
  if (!contentLabel || !contentText || !contentRef) return;
  
  let contentType, content;
  
  if (random) {
    // Random content from any category
    const allTypes = Object.keys(dailyContent);
    contentType = allTypes[Math.floor(Math.random() * allTypes.length)];
    const items = dailyContent[contentType];
    content = items[Math.floor(Math.random() * items.length)];
  } else {
    // Daily rotation through content types
    contentType = getContentTypeForDay();
    
    // If it's verse day, try to fetch from API
    if (contentType === 'verses') {
      const apiVerse = await fetchBibleVerse();
      if (apiVerse) {
        content = apiVerse;
      } else {
        // Fallback to local verses
        const items = dailyContent[contentType];
        const index = getDayOfYear() % items.length;
        content = items[index];
      }
    } else {
      const items = dailyContent[contentType];
      const index = getDayOfYear() % items.length;
      content = items[index];
    }
  }
  
  contentLabel.textContent = getContentLabel(contentType);
  
  // Format text based on content type
  if (contentType === 'verses') {
    contentText.innerHTML = `"${content.text}"`;
    contentText.style.fontStyle = 'italic';
  } else {
    contentText.innerHTML = content.text;
    contentText.style.fontStyle = 'normal';
  }
  
  contentRef.textContent = `— ${content.ref}`;
}

// Share daily content
const shareContentBtn = document.getElementById('share-content');
if (shareContentBtn) {
  shareContentBtn.addEventListener('click', () => {
    const label = document.getElementById('content-label')?.textContent || '';
    const text = document.getElementById('content-text')?.textContent || '';
    const ref = document.getElementById('content-ref')?.textContent || '';
    const websiteUrl = window.location.origin + window.location.pathname;
    const shareText = `${label}\n\n${text}\n\n${ref}\n\nSeed the Word Ministry\n${websiteUrl}\nJoin us: https://t.me/seedtheword`;
    
    if (navigator.share) {
      navigator.share({ 
        title: label,
        text: shareText,
        url: websiteUrl
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(shareText).then(() => {
        // Show temporary feedback
        const originalHTML = shareContentBtn.innerHTML;
        shareContentBtn.innerHTML = '<span>✓</span> Copied!';
        shareContentBtn.style.background = 'rgba(76, 175, 80, 0.3)';
        shareContentBtn.style.borderColor = 'rgba(76, 175, 80, 0.5)';
        setTimeout(() => {
          shareContentBtn.innerHTML = originalHTML;
          shareContentBtn.style.background = '';
          shareContentBtn.style.borderColor = '';
        }, 2000);
      }).catch(() => {
        alert('Could not copy content. Please try again.');
      });
    }
  });
}

// New content button
const newContentBtn = document.getElementById('new-content');
if (newContentBtn) {
  newContentBtn.addEventListener('click', () => {
    loadDailyContent(true);
    // Add a little animation
    const banner = document.querySelector('.daily-content-banner__content');
    if (banner) {
      banner.style.transform = 'scale(0.98)';
      setTimeout(() => {
        banner.style.transform = '';
      }, 200);
    }
  });
}

// Load content on page load
loadDailyContent();
// ── OLD MINISTRY CALENDAR COMPLETELY REMOVED ─────────────────────────────────────
// This old calendar system has been completely removed to prevent conflicts
// with the new Google Calendar integration. All calendar functionality is now
// handled by the GoogleCalendarIntegration class in google-calendar.js

// ── Load CMS Events for Announcements ─────────────────────────────────
async function loadCMSAnnouncements() {
  try {
    // Load events from GitHub API (since we can't directly access _data folder from frontend)
    const repoUrl = 'https://api.github.com/repos/seedtheword/seedtheword/contents/site/_data/events';
    const response = await fetch(repoUrl);
    
    if (response.ok) {
      const files = await response.json();
      const events = [];
      
      for (const file of files) {
        if (file.name.endsWith('.md')) {
          try {
            const fileResponse = await fetch(file.download_url);
            const content = await fileResponse.text();
            const event = parseAnnouncementFile(content);
            if (event) {
              events.push(event);
            }
          } catch (error) {
            console.log('Error loading announcement file:', file.name);
          }
        }
      }
      
      // Update announcements with CMS data
      updateAnnouncementsDisplay(events);
    }
  } catch (error) {
    console.log('Using default announcements, CMS not available');
  }
}

function parseAnnouncementFile(content) {
  try {
    const lines = content.split('\n');
    let inFrontmatter = false;
    let frontmatter = {};
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '---') {
        if (!inFrontmatter) {
          inFrontmatter = true;
          continue;
        } else {
          break;
        }
      }
      
      if (inFrontmatter && line.includes(':')) {
        const [key, ...valueParts] = line.split(':');
        const value = valueParts.join(':').trim().replace(/['"]/g, '');
        frontmatter[key.trim()] = value;
      }
    }
    
    if (frontmatter.title && frontmatter.datetime) {
      const eventDate = new Date(frontmatter.datetime);
      const now = new Date();
      
      return {
        title: frontmatter.title,
        date: eventDate,
        type: frontmatter.status || 'upcoming',
        time: eventDate.toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit',
          timeZoneName: 'short'
        }),
        description: frontmatter.description,
        button_text: frontmatter.button_text || 'Learn More',
        button_link: frontmatter.button_link || '#',
        isToday: eventDate.toDateString() === now.toDateString(),
        isPast: eventDate < now,
        isFuture: eventDate > now
      };
    }
  } catch (error) {
    console.log('Error parsing announcement:', error);
  }
  return null;
}

function updateAnnouncementsDisplay(events) {
  // Sort events by date
  events.sort((a, b) => a.date - b.date);
  
  const now = new Date();
  const liveEvents = events.filter(e => e.isToday && e.type === 'live');
  const currentEvents = events.filter(e => (e.isToday || e.isFuture) && e.type !== 'live');
  const upcomingEvents = events.filter(e => e.isFuture).slice(0, 3);
  
  // Update Live & Current column
  const liveColumn = document.querySelector('.announcements-column:first-child .announcements-list');
  if (liveColumn && liveEvents.length > 0) {
    const liveHTML = liveEvents.map(event => `
      <div class="announcement-item live">
        <div class="announcement-item__status">🔴 LIVE NOW</div>
        <div class="announcement-item__content">
          <h4>${event.title}</h4>
          <p class="announcement-item__time">${event.time}</p>
          <p class="announcement-item__desc">${event.description}</p>
          <a href="${event.button_link}" class="btn btn-primary btn-sm">${event.button_text}</a>
        </div>
      </div>
    `).join('');
    
    liveColumn.innerHTML = liveHTML + liveColumn.innerHTML;
  }
  
  // Update Upcoming Events column
  const upcomingColumn = document.querySelector('.announcements-column:nth-child(2) .announcements-list');
  if (upcomingColumn && upcomingEvents.length > 0) {
    const upcomingHTML = upcomingEvents.map(event => `
      <div class="announcement-item upcoming">
        <div class="announcement-item__status">📅 ${event.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()}</div>
        <div class="announcement-item__content">
          <h4>${event.title}</h4>
          <p class="announcement-item__time">${event.time}</p>
          <p class="announcement-item__desc">${event.description}</p>
          <a href="${event.button_link}" class="btn btn-secondary btn-sm">${event.button_text}</a>
        </div>
      </div>
    `).join('');
    
    upcomingColumn.innerHTML = upcomingHTML;
  }
}

// Load CMS announcements when page loads
document.addEventListener('DOMContentLoaded', () => {
  if (window.location.pathname.includes('news.html')) {
    loadCMSAnnouncements();
  }
});

// Initialize calendar when DOM is loaded - OLD CALENDAR SYSTEM REMOVED
document.addEventListener('DOMContentLoaded', () => {
  console.log('✅ Old ministry calendar completely removed - using Google Calendar integration only');
  // OLD: window.ministryCalendar = new MinistryCalendar(); // COMPLETELY REMOVED
  
  // Load CMS events after a short delay - DISABLED
  setTimeout(() => {
    console.log('✅ CMS events disabled - using Google Calendar integration only');
  }, 2000);
});

// Global function to refresh calendar events - UPDATED FOR GOOGLE CALENDAR ONLY
function refreshCalendarEvents() {
  // OLD calendar system completely removed
  console.log('✅ Old calendar system removed - using Google Calendar refresh only');
  
  // Use the Google Calendar refresh function instead
  if (window.refreshGoogleCalendar) {
    window.refreshGoogleCalendar();
    return;
  }
  
  // Also refresh announcements if on news page
  if (window.location.pathname.includes('news.html')) {
    loadCMSAnnouncements();
  }
  
  // Show feedback
  const button = event.target;
  const originalText = button.innerHTML;
  button.innerHTML = '<span>✓</span> Refreshed!';
  button.style.background = 'rgba(76, 175, 80, 0.3)';
  
  setTimeout(() => {
    button.innerHTML = originalText;
    button.style.background = '';
  }, 2000);
}

// Make refresh function globally available
window.refreshCalendarEvents = refreshCalendarEvents;

// Also initialize if script loads after DOM - OLD CALENDAR SYSTEM REMOVED
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('✅ Old ministry calendar completely removed');
    // OLD: window.ministryCalendar = new MinistryCalendar(); // COMPLETELY REMOVED
  });
} else {
  console.log('✅ Old ministry calendar completely removed');
  // OLD: window.ministryCalendar = new MinistryCalendar(); // COMPLETELY REMOVED
}

// ── Prayer Form Integration ─────────────────────────────────
function showPrayerForm() {
  // Scroll to contact form on about page or show modal
  const contactSection = document.getElementById('contact');
  if (contactSection) {
    // If we're on the about page, scroll to contact form
    contactSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    
    // Focus on the message field and add prayer request context
    setTimeout(() => {
      const messageField = document.querySelector('#contact-form [name="message"]');
      if (messageField) {
        messageField.focus();
        if (!messageField.value.trim()) {
          messageField.value = 'Prayer Request: ';
          messageField.setSelectionRange(16, 16); // Position cursor after "Prayer Request: "
        }
      }
    }, 500);
  } else {
    // If we're on another page, redirect to about page with prayer request
    window.location.href = 'about.html#contact';
  }
}

// Make function globally available
window.showPrayerForm = showPrayerForm;

// ── Archive Modal Functions ─────────────────────────────────
function showArchiveModal() {
  const modal = document.getElementById('archive-modal');
  const modalBody = document.getElementById('archive-modal-body');
  
  if (!modal || !modalBody) return;
  
  // Show modal
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  
  // Load archive content (this would come from Netlify CMS in production)
  loadArchiveContent(modalBody);
}

function closeArchiveModal() {
  const modal = document.getElementById('archive-modal');
  if (!modal) return;
  
  modal.style.display = 'none';
  document.body.style.overflow = '';
}

function loadArchiveContent(container) {
  // Simulate loading archive content
  // In production, this would fetch from Netlify CMS
  setTimeout(() => {
    container.innerHTML = `
      <div class="archive-content">
        <div class="archive-section">
          <h4>🎥 Recent Livestreams</h4>
          <div class="archive-items">
            <div class="archive-item">
              <div class="archive-item__thumbnail">
                <div class="archive-item__play">▶️</div>
              </div>
              <div class="archive-item__content">
                <h5>Study Saturday - January 25, 2026</h5>
                <p>Bible study on Matthew 5-7 • Prayer requests • Community fellowship</p>
                <a href="https://twitch.tv/seedtheword" target="_blank" class="btn btn-sm btn-secondary">Watch on Twitch</a>
              </div>
            </div>
            
            <div class="archive-item">
              <div class="archive-item__thumbnail">
                <div class="archive-item__play">▶️</div>
              </div>
              <div class="archive-item__content">
                <h5>Study Saturday - January 18, 2026</h5>
                <p>New Testament overview • Testimony sharing • Prayer circle</p>
                <a href="https://twitch.tv/seedtheword" target="_blank" class="btn btn-sm btn-secondary">Watch on Twitch</a>
              </div>
            </div>
          </div>
        </div>
        
        <div class="archive-section">
          <h4>📸 Ministry Events</h4>
          <div class="archive-items">
            <div class="archive-item">
              <div class="archive-item__thumbnail">
                <div class="archive-item__icon">📸</div>
              </div>
              <div class="archive-item__content">
                <h5>Youth Outreach - January 2026</h5>
                <p>Connecting with local youth and sharing the Gospel in our community</p>
                <a href="https://instagram.com/seedtheword" target="_blank" class="btn btn-sm btn-instagram">View on Instagram</a>
              </div>
            </div>
            
            <div class="archive-item">
              <div class="archive-item__thumbnail">
                <div class="archive-item__icon">📦</div>
              </div>
              <div class="archive-item__content">
                <h5>Bible Bundle Packing Day</h5>
                <p>Community volunteers preparing personalized Bible bundles with love</p>
                <a href="https://instagram.com/seedtheword" target="_blank" class="btn btn-sm btn-instagram">View on Instagram</a>
              </div>
            </div>
          </div>
        </div>
        
        <div class="archive-section">
          <h4>📖 Bible Study Resources</h4>
          <div class="archive-items">
            <div class="archive-item">
              <div class="archive-item__thumbnail">
                <div class="archive-item__icon">📖</div>
              </div>
              <div class="archive-item__content">
                <h5>New Testament Reading Plan</h5>
                <p>Complete guide for reading through the New Testament with our community</p>
                <a href="https://t.me/seedtheword" target="_blank" class="btn btn-sm btn-telegram">Join Study Group</a>
              </div>
            </div>
            
            <div class="archive-item">
              <div class="archive-item__thumbnail">
                <div class="archive-item__icon">🙏</div>
              </div>
              <div class="archive-item__content">
                <h5>Prayer & Testimony Archive</h5>
                <p>Collection of answered prayers and testimonies from our community</p>
                <a href="about.html#contact" class="btn btn-sm btn-secondary">Share Your Story</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }, 500);
}

// Archive modal event listeners
document.addEventListener('DOMContentLoaded', () => {
  const archiveModal = document.getElementById('archive-modal');
  const archiveClose = document.getElementById('archive-modal-close');
  
  if (archiveClose) {
    archiveClose.addEventListener('click', closeArchiveModal);
  }
  
  if (archiveModal) {
    archiveModal.querySelector('.archive-modal__backdrop')?.addEventListener('click', closeArchiveModal);
  }
  
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && archiveModal && archiveModal.style.display === 'flex') {
      closeArchiveModal();
    }
  });
});

// Make functions globally available
window.showArchiveModal = showArchiveModal;
window.closeArchiveModal = closeArchiveModal;

// ── Community Livestream Integration ─────────────────────────────────
class CommunityLiveStream {
  constructor() {
    this.isLive = false;
    this.streamData = null;
    this.init();
  }
  
  async init() {
    await this.checkLiveStatus();
    this.updateStreamCard();
  }
  
  async checkLiveStatus() {
    try {
      // Check if we have live stream data from CMS
      const response = await fetch('/site/_data/livestream.json');
      if (response.ok) {
        const data = await response.json();
        this.isLive = data.is_live || false;
        this.streamData = data;
      }
    } catch (error) {
      console.log('Livestream data not available, using offline state');
      this.isLive = false;
    }
  }
  
  updateStreamCard() {
    const streamCard = document.getElementById('stream-status-card');
    if (!streamCard) return;
    
    if (this.isLive && this.streamData) {
      streamCard.innerHTML = `
        <div class="stream-status-live">
          <h4>
            <span class="live-indicator">LIVE</span>
            ${this.streamData.title || 'Study Saturday Live'}
          </h4>
          <div class="live-stream-details">
            <p class="stream-description">Join us now for Bible study, fellowship, and prayer with our community worldwide!</p>
            <div class="live-engagement">
              <p><strong>What's Happening:</strong></p>
              <ul style="list-style: none; padding: 0; margin: 0.5rem 0;">
                <li>📖 Bible study discussion</li>
                <li>💬 Community fellowship</li>
                <li>🙏 Prayer requests & thanksgiving</li>
              </ul>
            </div>
          </div>
          <div class="stream-actions">
            <a href="${this.streamData.twitch_url || 'https://twitch.tv/seedtheword'}" target="_blank" class="btn btn-primary btn-sm">
              <span>📺</span> Watch Live
            </a>
          </div>
        </div>
      `;
    } else {
      // Keep the default offline state that's already in the HTML
    }
  }
  
  // Methods for admin control
  goLive(streamData) {
    this.isLive = true;
    this.streamData = streamData;
    this.updateStreamCard();
  }
  
  goOffline() {
    this.isLive = false;
    this.streamData = null;
    this.updateStreamCard();
  }
}

// Initialize community livestream
document.addEventListener('DOMContentLoaded', () => {
  window.communityLiveStream = new CommunityLiveStream();
});

// Also initialize if script loads after DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.communityLiveStream = new CommunityLiveStream();
  });
} else {
  window.communityLiveStream = new CommunityLiveStream();
}


// ── Seed-tile mobile tap toggle ─────────────────────────────
// The S.E.E.D. story tiles on about.html rely on :hover to reveal the
// overlay. On touch devices there is no :hover, so a tap on a tile
// toggles a .seed-tile--open class that triggers the same reveal.
// Tapping outside closes any open tile. Keyboard users get the same
// behavior via :focus-within in CSS, plus Escape to close here.
(function initSeedTileTaps() {
  const tiles = document.querySelectorAll('.seed-tile');
  if (!tiles.length) return;

  // Mark tiles as focusable so :focus-within picks them up for keyboard
  // users who tab into the grid.
  tiles.forEach((tile) => {
    if (!tile.hasAttribute('tabindex')) tile.setAttribute('tabindex', '0');
    if (!tile.hasAttribute('role')) tile.setAttribute('role', 'button');
    if (!tile.hasAttribute('aria-expanded')) tile.setAttribute('aria-expanded', 'false');
  });

  const closeAll = (except) => {
    tiles.forEach((t) => {
      if (t === except) return;
      t.classList.remove('seed-tile--open');
      t.setAttribute('aria-expanded', 'false');
    });
  };

  tiles.forEach((tile) => {
    tile.addEventListener('click', (e) => {
      // Let links inside the overlay behave normally.
      if (e.target.closest('a')) return;
      const willOpen = !tile.classList.contains('seed-tile--open');
      closeAll(tile);
      tile.classList.toggle('seed-tile--open', willOpen);
      tile.setAttribute('aria-expanded', String(willOpen));
    });
    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        tile.click();
      }
    });
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.seed-tile')) closeAll(null);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAll(null);
  });
})();


// ── How We S.E.E.D. accordion ────────────────────────────────
// Uses native <details>/<summary> on about.html — no JS required.
