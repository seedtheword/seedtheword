(function(){
'use strict';

// ═══════════════════════════════════════════════════════════════
// LMS Engine — Swipeable card courses, progress, badges
// ═══════════════════════════════════════════════════════════════

var LMS_STORAGE_KEY = 'stwm-lms-progress';

// ── Progress Persistence ──────────────────────────────────────
function getProgress() {
  try { return JSON.parse(localStorage.getItem(LMS_STORAGE_KEY)) || {}; } catch(e) { return {}; }
}
function saveProgress(data) {
  try { localStorage.setItem(LMS_STORAGE_KEY, JSON.stringify(data)); } catch(e) {}
}
function getCourseProgress(courseId) {
  var p = getProgress();
  return p[courseId] || { completed: false, currentCard: 0, completedCards: [], daysChecked: [] };
}
function setCourseProgress(courseId, data) {
  var p = getProgress();
  p[courseId] = data;
  saveProgress(p);
}

// ── Badge System ──────────────────────────────────────────────
var BADGES = [
  { id: 'four-laws', label: 'Four Laws', icon: '✝️', course: 'four-spiritual-laws' },
  { id: 'believer-to-disciple', label: 'From Believer to Disciple', icon: '📖', course: '20-day-plan' },
  { id: 'seed-onboarding', label: 'SEED Trained', icon: '🌱', course: 'what-is-seed' },
  { id: 'marriage-young-adults', label: 'Young Adults', icon: '💒', course: 'marriage-young-adults' },
  { id: 'outreach-partnerships', label: 'Outreach Ready', icon: '🤝', course: 'outreach-partnerships' },
  { id: 'social-media', label: 'Digital Evangelist', icon: '📱', course: 'social-media' },
  { id: 'deeper-doctrine', label: 'Doctrine Scholar', icon: '📜', course: 'deeper-doctrine' },
  { id: 'recommended-listening', label: 'Listener', icon: '🎧', course: 'recommended-listening' }
];

function getEarnedBadges() {
  var p = getProgress();
  return BADGES.filter(function(b) { return p[b.course] && p[b.course].completed; });
}

// ── Phase Dashboard Logic ─────────────────────────────────────
function getCurrentPhase() {
  var month = new Date().getMonth(); // 0-indexed
  // Phase 1: Jan-Mar (Plant the Seed)
  // Phase 2: Apr-Jun (Water to Grow)
  // Phase 3: Jul-Sep (Gather the Harvest)
  // Intermission: Oct-Dec (Remain in Jesus)
  if (month <= 2) return { id: 1, name: 'Plant the Seed', icon: '🌱', desc: 'Evangelism season — sharing the Gospel, giving Bibles, meeting newcomers where they are.' };
  if (month <= 5) return { id: 2, name: 'Water to Grow', icon: '💧', desc: 'Discipleship season — walking alongside believers through Bible reading, prayer, and fellowship.' };
  if (month <= 8) return { id: 3, name: 'Gather the Harvest', icon: '🌾', desc: 'Harvest season — helping mature believers find their place in the body of Christ.' };
  return { id: 4, name: 'Remain in Jesus', icon: '🍂', desc: 'Intermission — rest, reflect, abide in Christ, and prepare for the next cycle.' };
}

// ═══════════════════════════════════════════════════════════════
// COURSE DATA
// ═══════════════════════════════════════════════════════════════

var COURSES = {
  'four-spiritual-laws': {
    title: 'Four Spiritual Laws',
    icon: '✝️',
    desc: 'Interactive presentation of the Gospel in 4 laws',
    badge: 'Four Laws',
    cards: buildFourLawsCards()
  },
  '20-day-plan': {
    title: '20-Day Reading Plan',
    icon: '📖',
    desc: 'Read through 4 weeks of Scripture — earn your badge',
    badge: 'From Believer to Disciple',
    badgeTag: 'starter',
    type: 'reading-plan'
  },
  'what-is-seed': {
    title: 'What is Seed the Word?',
    icon: '🌱',
    desc: 'Learn about our ministry, values, and how we operate',
    badge: 'SEED Trained',
    badgeTag: 'starter',
    cards: buildSeedCourseCards()
  },
  'marriage-young-adults': {
    title: 'Marriage & Young Adults',
    icon: '💒',
    desc: 'Topics for young adult discipleship',
    badge: 'Young Adults',
    placeholder: true
  },
  'outreach-partnerships': {
    title: 'Outreach & Partnerships',
    icon: '🤝',
    desc: 'How partnering with other ministries works',
    badge: 'Outreach Ready',
    placeholder: true
  },
  'social-media': {
    title: 'Social Media for Jesus',
    icon: '📱',
    desc: 'Using social media presence for evangelism',
    badge: 'Digital Evangelist',
    placeholder: true
  },
  'deeper-doctrine': {
    title: 'Deeper Doctrine & Water Baptism',
    icon: '📜',
    desc: 'Doctrinal training and baptism preparation',
    badge: 'Doctrine Scholar',
    placeholder: true
  },
  'recommended-listening': {
    title: 'Recommended Listening',
    icon: '🎧',
    desc: 'Friends in Jesus — channels, podcasts, and content',
    badge: 'Listener',
    cards: buildListeningCards()
  }
};

// ═══════════════════════════════════════════════════════════════
// COURSE 1: FOUR SPIRITUAL LAWS
// ═══════════════════════════════════════════════════════════════
function buildFourLawsCards() {
  return [
    // Card 1: Intro
    {
      eyebrow: 'Introduction',
      heading: 'Have You Heard of the Four Spiritual Laws?',
      content: '<p class="lms-card__text">Just as there are physical laws that govern the physical universe, so are there spiritual laws that govern your relationship with God.</p><p class="lms-card__text" style="font-size:0.82rem;color:var(--color-text-muted);font-style:italic;">References should be read in context from the Bible wherever possible.</p>'
    },
    // Card 2: Law 1
    {
      eyebrow: 'Law 1',
      heading: 'God loves you and offers a wonderful plan for your life.',
      content: '<div class="lms-card__scripture"><p>"God so loved the world that He gave His one and only Son, that whoever believes in Him shall not perish but have eternal life."</p><cite>John 3:16 NIV</cite></div><div class="lms-card__scripture"><p>"I came that they might have life, and might have it abundantly" [that it might be full and meaningful].</p><cite>John 10:10 — Christ speaking</cite></div><p class="lms-card__text">Why is it that most people are not experiencing the abundant life?</p><p class="lms-card__text" style="font-weight:600;">Because...</p>'
    },
    // Card 3: Law 2
    {
      eyebrow: 'Law 2',
      heading: 'Man is sinful and separated from God.',
      content: '<p class="lms-card__text">Therefore, he cannot know and experience God\'s love and plan for his life.</p><div class="lms-card__scripture"><p>"All have sinned and fall short of the glory of God."</p><cite>Romans 3:23</cite></div><p class="lms-card__text">Man was created to have fellowship with God; but because of his own stubborn self-will, he chose to go his own independent way and fellowship with God was broken. This self-will, characterized by an attitude of active rebellion or passive indifference, is what the Bible calls sin.</p><div class="lms-card__scripture"><p>"The wages of sin is death" [spiritual separation from God].</p><cite>Romans 6:23</cite></div>'
    },
    // Card 4: Law 2 Diagram
    {
      eyebrow: 'Law 2 — Illustrated',
      heading: 'The Gulf Between Man and God',
      content: '<div class="lms-card__diagram"><div class="lms-card__diagram-label">Diagram</div><div class="lms-card__diagram-visual">🟡 Holy God<br><br>⬆️ ⬆️ ⬆️<br><br>🔴 Sinful Man</div><div class="lms-card__diagram-desc">God is holy and man is sinful. A great gulf separates the two. Man continually tries to reach God and the abundant life through his own efforts — a good life, philosophy, or religion — but inevitably fails.</div></div><p class="lms-card__text">The third law explains the only way to bridge this gulf...</p>'
    },
    // Card 5: Law 3
    {
      eyebrow: 'Law 3',
      heading: 'Jesus Christ is God\'s only provision for man\'s sin.',
      content: '<p class="lms-card__text">Through Him you can know and experience God\'s love and plan for your life.</p><div class="lms-card__scripture"><p>"God demonstrates His own love toward us, in that while we were yet sinners, Christ died for us."</p><cite>Romans 5:8</cite></div><div class="lms-card__scripture"><p>"Christ died for our sins...He was buried...He was raised on the third day, according to the Scriptures...He appeared to Peter, then to the twelve. After that He appeared to more than five hundred."</p><cite>1 Corinthians 15:3-6</cite></div><div class="lms-card__scripture"><p>"I am the way, and the truth, and the life; no one comes to the Father but through Me."</p><cite>John 14:6 — Jesus speaking</cite></div>'
    },
    // Card 6: Law 3 Diagram
    {
      eyebrow: 'Law 3 — Illustrated',
      heading: 'The Bridge',
      content: '<div class="lms-card__diagram"><div class="lms-card__diagram-label">Diagram</div><div class="lms-card__diagram-visual">🟡 God<br>✝️<br>🔵 Man</div><div class="lms-card__diagram-desc">God has bridged the gulf that separates us from Him by sending His Son, Jesus Christ, to die on the cross in our place to pay the penalty for our sins.</div></div><p class="lms-card__text">It is not enough just to know these three laws...</p>'
    },
    // Card 7: Law 4
    {
      eyebrow: 'Law 4',
      heading: 'We must individually receive Jesus Christ as Savior and Lord.',
      content: '<p class="lms-card__text">Then we can know and experience God\'s love and plan for our lives.</p><div class="lms-card__scripture"><p>"As many as received Him, to them He gave the right to become children of God, even to those who believe in His name."</p><cite>John 1:12</cite></div><div class="lms-card__scripture"><p>"By grace you have been saved through faith; and that not of yourselves, it is the gift of God; not as a result of works that no one should boast."</p><cite>Ephesians 2:8-9</cite></div><p class="lms-card__text">When we receive Christ, we experience a new birth (John 3:1-8).</p>'
    },
    // Card 8: Two Circles
    {
      eyebrow: 'Law 4 — Two Kinds of Lives',
      heading: 'Which circle represents your life?',
      content: '<p class="lms-card__text">Receiving Christ involves turning to God from self (repentance) and trusting Christ to come into our lives to forgive our sins and to make us what He wants us to be. It is not just intellectual agreement or emotional experience — we receive Jesus Christ by faith, as an act of the will.</p><div class="lms-card__diagram"><div class="lms-card__diagram-label">Self-Directed Life</div><div class="lms-card__diagram-visual">🔴</div><div class="lms-card__diagram-desc"><strong>S</strong> — Self on the throne<br><strong>✝️</strong> — Christ outside the life<br><strong>•</strong> — Interests directed by self, often resulting in discord and frustration</div></div><div class="lms-card__diagram"><div class="lms-card__diagram-label">Christ-Directed Life</div><div class="lms-card__diagram-visual">🟢</div><div class="lms-card__diagram-desc"><strong>✝️</strong> — Christ in the life and on the throne<br><strong>S</strong> — Self yielding to Christ<br><strong>•</strong> — Interests directed by Christ, resulting in harmony with God\'s plan</div></div>'
    },
    // Card 9: Prayer
    {
      eyebrow: 'Invitation',
      heading: 'You Can Receive Christ Right Now by Faith Through Prayer',
      content: '<p class="lms-card__text">God knows your heart and is not so concerned with your words as He is with the attitude of your heart. The following is a suggested prayer:</p><div class="lms-card__prayer"><p>Lord Jesus, I need You. Thank You for dying on the cross for my sins. I open the door of my life and receive You as my Savior and Lord. Thank You for forgiving my sins and giving me eternal life. Take control of the throne of my life. Make me the kind of person You want me to be.</p></div><p class="lms-card__text">Does this prayer express the desire of your heart? If it does, pray this prayer right now, and Christ will come into your life, as He promised.</p>'
    },
    // Card 10: Assurance
    {
      eyebrow: 'Assurance',
      heading: 'How to Know That Christ Is in Your Life',
      content: '<p class="lms-card__text">According to His promise in Revelation 3:20, where is Christ right now in relation to you? Christ said He would come into your life. Would He mislead you?</p><p class="lms-card__text">On what authority do you know God has answered your prayer? <strong>The trustworthiness of God Himself and His Word.</strong></p><div class="lms-card__scripture"><p>"God has given us eternal life, and this life is in His Son. He who has the Son has the life; he who does not have the Son of God does not have the life. These things I have written to you who believe in the name of the Son of God, in order that you may know that you have eternal life."</p><cite>1 John 5:11-13</cite></div><p class="lms-card__text">You can know on the basis of His promise that Christ lives in you and that you have eternal life from the very moment you invite Him in. He will not deceive you.</p>'
    },
    // Card 11: Do Not Depend on Feelings
    {
      eyebrow: 'Important Reminder',
      heading: 'Do Not Depend on Feelings',
      content: '<p class="lms-card__text">The promise of God\'s Word, the Bible — not our feelings — is our authority. The Christian lives by faith (trust) in the trustworthiness of God Himself and His Word.</p><div class="lms-card__diagram"><div class="lms-card__diagram-label">The Train Illustration</div><div class="lms-card__diagram-visual">🚂 Fact → 🚃 Faith → 🚃 Feeling</div><div class="lms-card__diagram-desc">The train will run with or without the caboose (feeling). It would be useless to pull the train by the caboose. As Christians we do not depend on feelings or emotions, but we place our faith (trust) in the trustworthiness of God and the promises of His Word.</div></div>'
    },
    // Card 12: Now What
    {
      eyebrow: 'Now That You Have Received Christ',
      heading: 'Many Things Happened',
      content: '<ul class="lms-card__list"><li><strong>Christ came into your life</strong> (Revelation 3:20; Colossians 1:27)</li><li><strong>Your sins were forgiven</strong> (Colossians 1:14)</li><li><strong>You became a child of God</strong> (John 1:12)</li><li><strong>You received eternal life</strong> (John 5:24)</li><li><strong>You began the great adventure</strong> for which God created you (John 10:10; 2 Corinthians 5:17; 1 Thessalonians 5:18)</li></ul><p class="lms-card__text">Can you think of anything more wonderful that could happen to you than receiving Christ? By thanking God, you demonstrate your faith.</p>'
    },
    // Card 13: GROWTH
    {
      eyebrow: 'Suggestions for Christian Growth',
      heading: 'G.R.O.W.T.H.',
      content: '<p class="lms-card__text">Spiritual growth results from trusting Jesus Christ. "The righteous man shall live by faith" (Galatians 3:11).</p><ul class="lms-card__list"><li><strong>G</strong> — Go to God in prayer daily (John 15:7)</li><li><strong>R</strong> — Read God\'s Word daily (Acts 17:11); begin with the Gospel of John</li><li><strong>O</strong> — Obey God moment by moment (John 14:21)</li><li><strong>W</strong> — Witness for Christ by your life and words (Matthew 4:19; John 15:8)</li><li><strong>T</strong> — Trust God for every detail of your life (1 Peter 5:7)</li><li><strong>H</strong> — Holy Spirit — allow Him to control and empower your daily life and witness (Galatians 5:16-17; Acts 1:8)</li></ul>'
    },
    // Card 14: Fellowship
    {
      eyebrow: 'Fellowship',
      heading: 'Fellowship in a Good Church',
      content: '<div class="lms-card__scripture"><p>"Not forsaking the assembling of ourselves together."</p><cite>Hebrews 10:25</cite></div><p class="lms-card__text">Several logs burn brightly together, but put one aside on the cold hearth and the fire goes out. So it is with your relationship with other Christians.</p><p class="lms-card__text">If you do not belong to a church, do not wait to be invited. Take the initiative; call the pastor of a nearby church where Christ is honored and His Word is preached. Start this week, and make plans to attend regularly.</p>'
    }
  ];
}

// ═══════════════════════════════════════════════════════════════
// COURSE 3: WHAT IS SEED THE WORD?
// ═══════════════════════════════════════════════════════════════
function buildSeedCourseCards() {
  var phase = getCurrentPhase();
  return [
    {
      eyebrow: 'Welcome',
      heading: 'What is Seed the Word?',
      content: '<p class="lms-card__text">Seed the Word is a ministry that places the living Word of God — Jesus Christ — into the hands of every newcomer we meet, and walks with them until they are rooted in Him.</p><p class="lms-card__text">We share the Gospel in everyday life, give Bibles freely, and disciple new believers through reading, prayer, fellowship, and worship.</p>'
    },
    {
      eyebrow: 'Our Name',
      heading: 'S.E.E.D.',
      content: '<p class="lms-card__text">Our name is an acronym that captures our four core values:</p><ul class="lms-card__list"><li><strong>S</strong> — Serve with Grace (2 Corinthians 3)</li><li><strong>E</strong> — Encounter the Word (John 1:1)</li><li><strong>E</strong> — Embrace Fellowship (Hebrews 10:19-25)</li><li><strong>D</strong> — Disciples of all Nations (Matthew 28)</li></ul>'
    },
    {
      eyebrow: 'Value: S',
      heading: 'Serve with Grace',
      content: '<p class="lms-card__text">As we are transformed into the image of Christ, we welcome others with the same grace that Jesus showed us. We serve newcomers to the faith by putting our differences aside to glorify God.</p><div class="lms-card__scripture"><p>"And we all, who with unveiled faces contemplate the Lord\'s glory, are being transformed into his image with ever-increasing glory."</p><cite>2 Corinthians 3:18 NIV</cite></div>'
    },
    {
      eyebrow: 'Value: E',
      heading: 'Encounter the Word',
      content: '<p class="lms-card__text">We read the Bible daily to encounter Jesus. Monday through Friday we read one chapter a day together, and on Saturdays we review the week.</p><div class="lms-card__scripture"><p>"In the beginning was the Word, and the Word was with God, and the Word was God."</p><cite>John 1:1</cite></div>'
    },
    {
      eyebrow: 'Value: E',
      heading: 'Embrace Fellowship',
      content: '<p class="lms-card__text">We encourage one another to fellowship in weekly gatherings where we read, worship, and minister.</p><ul class="lms-card__list"><li><strong>Tuesdays</strong> — we visit life groups for newcomers to faith</li><li><strong>Fridays</strong> — we gather as young adults</li><li><strong>Sundays</strong> — we go to church</li><li><strong>Saturdays</strong> — we review readings and dig deeper</li></ul>'
    },
    {
      eyebrow: 'Value: D',
      heading: 'Disciples of All Nations',
      content: '<div class="lms-card__scripture"><p>"Therefore go and make disciples of all nations, baptizing them in the name of the Father and of the Son and of the Holy Spirit, and teaching them to obey everything I have commanded you. And surely I am with you always, to the very end of the age."</p><cite>Matthew 28:19-20 NIV</cite></div><p class="lms-card__text">We give away Bibles — on the street, to newcomers, to anyone who wants one but can\'t afford one.</p>'
    },
    {
      eyebrow: 'Mission & Vision',
      heading: 'Why We Exist',
      content: '<p class="lms-card__text"><strong>Mission:</strong> To place the living Word of God — Jesus Christ — into the hands of every newcomer we meet, and to walk with them until they are rooted in Him.</p><p class="lms-card__text"><strong>Vision:</strong> A generation that doesn\'t just hear the Word but knows Him — who love Jesus personally, treasure His scripture deeply, and carry that light into homes, workplaces, and the nations.</p>'
    },
    {
      eyebrow: 'The Three Phases',
      heading: 'How a Seed Becomes a Harvest',
      content: '<ul class="lms-card__list"><li><strong>Phase 1: Plant the Seed</strong> — Evangelism. Meet newcomers where they are, share the Gospel, give away Bibles. (Luke 8:11)</li><li><strong>Phase 2: Water to Grow</strong> — Discipleship. Walk alongside believers through Bible reading, prayer, fellowship, and worship. (1 Corinthians 3:6-7)</li><li><strong>Phase 3: Gather the Harvest</strong> — Help mature believers find their place in the body of Christ — a local church, a life group, a calling to serve. (Matthew 9:37-38)</li><li><strong>Intermission: Remain in Jesus</strong> — Rest, reflect, abide in Christ, and prepare for the next cycle. (John 15:4)</li></ul>'
    },
    {
      eyebrow: 'Live Dashboard',
      heading: 'Where Are We Now?',
      content: '<div class="lms-phase-dashboard"><div class="lms-phase-dashboard__title">Current Ministry Phase</div><div class="lms-phase-dashboard__phases"><div class="lms-phase' + (phase.id === 1 ? ' lms-phase--active' : '') + '"><span class="lms-phase__icon">🌱</span><span class="lms-phase__name">Phase 1: Plant the Seed (Jan-Mar)</span>' + (phase.id === 1 ? '<span class="lms-phase__badge">NOW</span>' : '') + '</div><div class="lms-phase' + (phase.id === 2 ? ' lms-phase--active' : '') + '"><span class="lms-phase__icon">💧</span><span class="lms-phase__name">Phase 2: Water to Grow (Apr-Jun)</span>' + (phase.id === 2 ? '<span class="lms-phase__badge">NOW</span>' : '') + '</div><div class="lms-phase' + (phase.id === 3 ? ' lms-phase--active' : '') + '"><span class="lms-phase__icon">🌾</span><span class="lms-phase__name">Phase 3: Gather the Harvest (Jul-Sep)</span>' + (phase.id === 3 ? '<span class="lms-phase__badge">NOW</span>' : '') + '</div><div class="lms-phase' + (phase.id === 4 ? ' lms-phase--active' : '') + '"><span class="lms-phase__icon">🍂</span><span class="lms-phase__name">Intermission: Remain in Jesus (Oct-Dec)</span>' + (phase.id === 4 ? '<span class="lms-phase__badge">NOW</span>' : '') + '</div></div></div><p class="lms-card__text"><strong>' + phase.name + ':</strong> ' + phase.desc + '</p>'
    },
    {
      eyebrow: 'How We Meet',
      heading: 'The Five Movements',
      content: '<p class="lms-card__text">When we gather, we move through five movements together:</p><ul class="lms-card__list"><li><strong>1. Worship & Prayer</strong> — We come to God first. Singing and prayer gather the room.</li><li><strong>2. Introduction</strong> — We greet each other and share what God has been doing.</li><li><strong>3. Encounter Jesus in the Word</strong> — We read the week\'s anchor chapter together.</li><li><strong>4. Reflection</strong> — Four questions: Where did we see grace? What does this say about God? What does it call us to? Who needs to hear this?</li><li><strong>5. How We Outreach</strong> — We share what\'s coming, pray over it, and walk out sent.</li></ul>'
    },
    // Quiz card
    {
      eyebrow: 'Understanding Check',
      heading: 'Quick Quiz',
      content: '<div class="lms-quiz" data-quiz="seed-1"><p class="lms-quiz__question">What does S.E.E.D. stand for?</p><div class="lms-quiz__options"><div class="lms-quiz__option" data-answer="wrong">Study, Evangelize, Equip, Deploy</div><div class="lms-quiz__option" data-answer="correct">Serve with Grace, Encounter the Word, Embrace Fellowship, Disciples of all Nations</div><div class="lms-quiz__option" data-answer="wrong">Share, Encourage, Empower, Deliver</div></div></div>'
    },
    {
      eyebrow: 'Understanding Check',
      heading: 'Quiz: The Phases',
      content: '<div class="lms-quiz" data-quiz="seed-2"><p class="lms-quiz__question">What is Phase 2 in our ministry cycle?</p><div class="lms-quiz__options"><div class="lms-quiz__option" data-answer="wrong">Plant the Seed</div><div class="lms-quiz__option" data-answer="correct">Water to Grow</div><div class="lms-quiz__option" data-answer="wrong">Gather the Harvest</div><div class="lms-quiz__option" data-answer="wrong">Remain in Jesus</div></div></div>'
    }
  ];
}

// ═══════════════════════════════════════════════════════════════
// COURSE 8: RECOMMENDED LISTENING
// ═══════════════════════════════════════════════════════════════
function buildListeningCards() {
  return [
    {
      eyebrow: 'Friends in Jesus',
      heading: 'Recommended Listening',
      content: '<p class="lms-card__text">These are creators, pastors, and friends we trust. Listen, learn, and let the Word work through their voices too.</p>'
    },
    {
      eyebrow: 'Featured',
      heading: 'After the Heart Podcast',
      content: '<p class="lms-card__text"><strong>Sam Petrov</strong> — our friend from the One Heart MVMT. His podcast explores what it means to pursue God\'s heart in everyday life.</p><p class="lms-card__text" style="font-size:0.85rem;"><a href="https://open.spotify.com/show/0D88O8K0Yx3pDFBqbnoDX8" target="_blank" rel="noopener" style="color:var(--color-olive);font-weight:600;">Listen on Spotify →</a></p>'
    },
    {
      eyebrow: 'YouTube Channels',
      heading: 'Channels We Watch',
      content: '<ul class="lms-card__list"><li><strong>HungryGen</strong> — Vlad Savchuk. Deep teaching on the Holy Spirit, spiritual warfare, and walking in power.</li><li><strong>David Diga Hernandez</strong> — Teaching on encountering the Holy Spirit in daily life.</li><li><strong>Nils Glenn</strong> — Prophetic teaching and encouragement for young believers.</li><li><strong>Bible Animations</strong> — Visual Bible stories. Great for sharing with newcomers.</li><li><strong>Forrest Frank</strong> — Worship music that hits different. Bold, unapologetic, Christ-centered.</li></ul>'
    },
    {
      eyebrow: 'Partner Ministries',
      heading: 'Who We Walk With',
      content: '<ul class="lms-card__list"><li><strong>For Zion Ministries</strong> — Keegan Milsten. Our first official ministry partnership. Trained our team in evangelism approaches and LGBTQ+ outreach with love and truth.</li><li><strong>One Heart MVMT</strong> — Sam Petrov. Community Cookouts with free food, prizes, and the Gospel at the center. Sam evangelizes, we supply Bibles.</li></ul><p class="lms-card__text">We believe in partnership over isolation. If you know a ministry doing good work, let leadership know.</p>'
    }
  ];
}

// ═══════════════════════════════════════════════════════════════
// 20-DAY READING PLAN DATA
// ═══════════════════════════════════════════════════════════════
var READING_PLAN = [
  { day:1, week:1, label:'Monday Bible Study #1 (DBS)', note:'Gather for the first Bible Discussion Study.' },
  { day:2, week:1, label:'John 1', anchor:'Lamb of God', yv:'https://www.bible.com/bible/59/JHN.1.ESV' },
  { day:3, week:1, label:'John 3:16 & 3:29', anchor:'Therefore this joy of mine is now complete.', yv:'https://www.bible.com/bible/59/JHN.3.ESV' },
  { day:4, week:1, label:'John 8', anchor:'I AM', yv:'https://www.bible.com/bible/59/JHN.8.ESV' },
  { day:5, week:1, label:'John 14:19', anchor:'...but you will see me.', yv:'https://www.bible.com/bible/59/JHN.14.ESV' },
  { day:6, week:2, label:'Monday Bible Study #2 (DBS)', note:'Bring what you\'ve been sitting with from the first week.' },
  { day:7, week:2, label:'Psalm 23', anchor:'The Lord is my shepherd', yv:'https://www.bible.com/bible/59/PSA.23.ESV' },
  { day:8, week:2, label:'Psalm 51', anchor:'O God of my salvation', yv:'https://www.bible.com/bible/59/PSA.51.ESV' },
  { day:9, week:2, label:'Psalm 139', anchor:'You are known', yv:'https://www.bible.com/bible/59/PSA.139.ESV' },
  { day:10, week:2, label:'Psalm 91', anchor:'...show him my salvation.', yv:'https://www.bible.com/bible/59/PSA.91.ESV' },
  { day:11, week:3, label:'Monday Bible Study #3 (DBS)', note:'What does it mean to receive grace?' },
  { day:12, week:3, label:'Romans 3:24', anchor:'...grace as a gift', yv:'https://www.bible.com/bible/59/ROM.3.ESV' },
  { day:13, week:3, label:'Romans 5:1 & 5:15', anchor:'...justified by faith / free gift', yv:'https://www.bible.com/bible/59/ROM.5.ESV' },
  { day:14, week:3, label:'Romans 8:16', anchor:'...children of God', yv:'https://www.bible.com/bible/59/ROM.8.ESV' },
  { day:15, week:3, label:'Romans 12:5 & 12:9', anchor:'...one body in Christ / Let love be genuine.', yv:'https://www.bible.com/bible/59/ROM.12.ESV' },
  { day:16, week:4, label:'Monday Bible Study #4 (DBS)', note:'How does faith show up in how I live?' },
  { day:17, week:4, label:'Matthew 6:9-13 & 9:33', anchor:'The Lord\'s Prayer', yv:'https://www.bible.com/bible/59/MAT.6.ESV' },
  { day:18, week:4, label:'James 1:2-8', anchor:'...testing of your faith produces steadfastness.', yv:'https://www.bible.com/bible/59/JAS.1.ESV' },
  { day:19, week:4, label:'1 John 4:8 & 4:11', anchor:'God is love / love one another.', yv:'https://www.bible.com/bible/59/1JN.4.ESV' },
  { day:20, week:4, label:'Philippians 4:6-7', anchor:'Do not be anxious...', yv:'https://www.bible.com/bible/59/PHP.4.ESV' }
];
var WEEK_TITLES = { 1:'Week 1: Who is Jesus', 2:'Week 2: Trust in God', 3:'Week 3: What is Salvation', 4:'Week 4: The Christian Walk' };

// ═══════════════════════════════════════════════════════════════
// RENDER CATALOG
// ═══════════════════════════════════════════════════════════════
function renderCatalog(container) {
  var progress = getProgress();
  var earned = getEarnedBadges();
  var courseIds = Object.keys(COURSES);

  // Badges summary
  var badgesHtml = '<div class="glass-card" style="margin-bottom:1rem;"><h3 class="glass-card__title">🏆 Your Achievements</h3><div class="lms-badges">';
  BADGES.forEach(function(b) {
    var isEarned = earned.some(function(e) { return e.id === b.id; });
    badgesHtml += '<span class="lms-badge ' + (isEarned ? 'lms-badge--earned' : 'lms-badge--locked') + '">' + b.icon + ' ' + b.label + '</span>';
  });
  badgesHtml += '</div></div>';

  // Course cards
  var catalogHtml = '<div class="lms-catalog">';
  courseIds.forEach(function(id) {
    var course = COURSES[id];
    var cp = progress[id] || { completed: false, currentCard: 0, completedCards: [], daysChecked: [] };
    var pct = 0;
    if (cp.completed) pct = 100;
    else if (course.type === 'reading-plan') pct = Math.round(((cp.daysChecked || []).length / 20) * 100);
    else if (course.cards) pct = Math.round((cp.currentCard / course.cards.length) * 100);

    var completedClass = cp.completed ? ' lms-course-card--completed' : '';
    var lockedClass = course.placeholder ? ' lms-course-card--locked' : '';
    var badgeHtml = '';
    if (cp.completed) badgeHtml = '<span class="lms-course-card__badge">✓ Complete</span>';
    else if (course.badgeTag === 'starter') badgeHtml = '<span class="lms-course-card__badge lms-course-card__badge--starter">Starter</span>';
    else if (course.placeholder) badgeHtml = '<span class="lms-course-card__badge lms-course-card__badge--coming">Coming Soon</span>';

    catalogHtml += '<div class="lms-course-card' + completedClass + lockedClass + '" data-course="' + id + '">' +
      '<div class="lms-course-card__icon">' + course.icon + '</div>' +
      '<div class="lms-course-card__body">' +
        '<div class="lms-course-card__name">' + course.title + '</div>' +
        '<div class="lms-course-card__desc">' + course.desc + ' ' + badgeHtml + '</div>' +
        (pct > 0 && !course.placeholder ? '<div class="lms-course-card__progress"><div class="lms-course-card__bar"><div class="lms-course-card__bar-fill" style="width:' + pct + '%"></div></div><span class="lms-course-card__pct">' + pct + '%</span></div>' : '') +
      '</div>' +
      '<span class="lms-course-card__arrow">' + (course.placeholder ? '🔒' : '→') + '</span>' +
    '</div>';
  });
  catalogHtml += '</div>';

  container.innerHTML = badgesHtml + catalogHtml;

  // Bind clicks
  container.querySelectorAll('.lms-course-card:not(.lms-course-card--locked)').forEach(function(el) {
    el.addEventListener('click', function() {
      var courseId = this.dataset.course;
      if (COURSES[courseId].type === 'reading-plan') openReadingPlan(courseId);
      else openCourseViewer(courseId);
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// SWIPEABLE COURSE VIEWER
// ═══════════════════════════════════════════════════════════════
function openCourseViewer(courseId) {
  var course = COURSES[courseId];
  if (!course || !course.cards) return;
  var cp = getCourseProgress(courseId);
  var currentIndex = cp.currentCard || 0;
  var totalCards = course.cards.length;

  // Build viewer DOM
  var viewer = document.createElement('div');
  viewer.className = 'lms-viewer';
  viewer.innerHTML = '<div class="lms-viewer__header"><h2 class="lms-viewer__title">' + course.title + '</h2><button class="lms-viewer__close" aria-label="Close">×</button></div>' +
    '<div class="lms-viewer__progress"><div class="lms-viewer__progress-bar" style="width:' + Math.round(((currentIndex + 1) / (totalCards + 1)) * 100) + '%"></div></div>' +
    '<div class="lms-deck"></div>' +
    '<div class="lms-viewer__nav"><button class="lms-viewer__nav-btn lms-viewer__nav-btn--prev" aria-label="Previous">‹</button><div style="text-align:center;flex:1;"><div class="lms-viewer__dots"></div><div class="lms-viewer__page-num"></div></div><button class="lms-viewer__nav-btn lms-viewer__nav-btn--next" aria-label="Next">›</button></div>';

  document.body.appendChild(viewer);
  document.body.style.overflow = 'hidden';

  var deck = viewer.querySelector('.lms-deck');
  var progressBar = viewer.querySelector('.lms-viewer__progress-bar');
  var dotsContainer = viewer.querySelector('.lms-viewer__dots');
  var pageNum = viewer.querySelector('.lms-viewer__page-num');
  var prevBtn = viewer.querySelector('.lms-viewer__nav-btn--prev');
  var nextBtn = viewer.querySelector('.lms-viewer__nav-btn--next');

  // Build dots
  function renderDots() {
    var html = '';
    for (var i = 0; i <= totalCards; i++) { // +1 for completion card
      var cls = 'lms-viewer__dot';
      if (i === currentIndex) cls += ' lms-viewer__dot--active';
      else if (i < currentIndex) cls += ' lms-viewer__dot--completed';
      html += '<span class="' + cls + '"></span>';
    }
    dotsContainer.innerHTML = html;
    pageNum.textContent = (currentIndex + 1) + ' / ' + (totalCards + 1);
  }

  // Render card
  function renderCard(index) {
    deck.innerHTML = '';
    var card = document.createElement('div');
    card.className = 'lms-card lms-card--active';

    if (index >= totalCards) {
      // Completion card
      card.classList.add('lms-card--completion');
      card.innerHTML = '<div class="lms-card__completion-icon">🎉</div><h2 class="lms-card__completion-title">Course Complete!</h2><p class="lms-card__completion-text">You\'ve finished "' + course.title + '". Well done, faithful student.</p><button class="lms-card__completion-btn">Return to Catalog</button>' + (course.badge ? '<div class="lms-card__completion-badge">' + course.icon + ' ' + course.badge + ' Earned</div>' : '');
      deck.appendChild(card);
      // Mark completed
      cp.completed = true;
      cp.currentCard = totalCards;
      setCourseProgress(courseId, cp);
      // Bind close
      card.querySelector('.lms-card__completion-btn').addEventListener('click', closeViewer);
    } else {
      var data = course.cards[index];
      card.innerHTML = (data.eyebrow ? '<div class="lms-card__eyebrow">' + data.eyebrow + '</div>' : '') +
        '<h2 class="lms-card__heading">' + data.heading + '</h2>' +
        data.content;
      deck.appendChild(card);
      // Bind quiz interactions
      bindQuizzes(card);
    }

    // Update progress
    progressBar.style.width = Math.round(((index + 1) / (totalCards + 1)) * 100) + '%';
    renderDots();
    prevBtn.disabled = index === 0;
    nextBtn.textContent = index >= totalCards ? '✓' : '›';

    // Save position
    cp.currentCard = index;
    setCourseProgress(courseId, cp);
  }

  function goTo(index) {
    if (index < 0 || index > totalCards) return;
    currentIndex = index;
    renderCard(currentIndex);
  }

  // Navigation
  prevBtn.addEventListener('click', function() { goTo(currentIndex - 1); });
  nextBtn.addEventListener('click', function() { goTo(currentIndex + 1); });

  // Swipe support
  var touchStartX = 0, touchEndX = 0;
  deck.addEventListener('touchstart', function(e) { touchStartX = e.changedTouches[0].screenX; }, { passive: true });
  deck.addEventListener('touchend', function(e) {
    touchEndX = e.changedTouches[0].screenX;
    var diff = touchStartX - touchEndX;
    if (Math.abs(diff) > 50) {
      if (diff > 0) goTo(currentIndex + 1); // swipe left = next
      else goTo(currentIndex - 1); // swipe right = prev
    }
  }, { passive: true });

  // Keyboard
  function onKey(e) {
    if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); goTo(currentIndex + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(currentIndex - 1); }
    if (e.key === 'Escape') closeViewer();
  }
  document.addEventListener('keydown', onKey);

  // Close
  function closeViewer() {
    document.removeEventListener('keydown', onKey);
    viewer.classList.add('lms-viewer--closing');
    setTimeout(function() {
      viewer.remove();
      document.body.style.overflow = '';
      // Re-render catalog
      var container = document.getElementById('lms-catalog-root');
      if (container) renderCatalog(container);
    }, 250);
  }
  viewer.querySelector('.lms-viewer__close').addEventListener('click', closeViewer);

  // Initial render
  renderCard(currentIndex);
}

// ═══════════════════════════════════════════════════════════════
// READING PLAN VIEWER (Course 2)
// ═══════════════════════════════════════════════════════════════
function openReadingPlan(courseId) {
  var cp = getCourseProgress(courseId);
  var daysChecked = cp.daysChecked || [];

  var viewer = document.createElement('div');
  viewer.className = 'lms-viewer';
  viewer.innerHTML = '<div class="lms-viewer__header"><h2 class="lms-viewer__title">20-Day Reading Plan</h2><button class="lms-viewer__close" aria-label="Close">×</button></div>' +
    '<div class="lms-viewer__progress"><div class="lms-viewer__progress-bar" style="width:' + Math.round((daysChecked.length / 20) * 100) + '%"></div></div>' +
    '<div class="lms-deck" style="position:relative;overflow-y:auto;padding:1.25rem;"></div>' +
    '<div class="lms-viewer__nav" style="justify-content:center;"><div style="text-align:center;"><div class="lms-viewer__page-num">' + daysChecked.length + ' / 20 days completed</div></div></div>';

  document.body.appendChild(viewer);
  document.body.style.overflow = 'hidden';

  var deck = viewer.querySelector('.lms-deck');
  var progressBar = viewer.querySelector('.lms-viewer__progress-bar');
  var pageNum = viewer.querySelector('.lms-viewer__page-num');

  function render() {
    var html = '<div class="lms-reading-plan">';
    [1,2,3,4].forEach(function(w) {
      html += '<div class="lms-reading-week"><h3 class="lms-reading-week__title">' + WEEK_TITLES[w] + '</h3>';
      READING_PLAN.filter(function(d) { return d.week === w; }).forEach(function(d) {
        var checked = daysChecked.indexOf(d.day) >= 0;
        var link = d.yv ? '<a class="lms-reading-day__link" href="' + d.yv + '" target="_blank" rel="noopener">Read →</a>' : '';
        var sub = d.anchor ? '"' + d.anchor + '"' : (d.note || '');
        html += '<div class="lms-reading-day"><div class="lms-reading-day__check' + (checked ? ' lms-reading-day__check--done' : '') + '" data-day="' + d.day + '">' + (checked ? '✓' : '') + '</div><div class="lms-reading-day__info"><div class="lms-reading-day__label">Day ' + d.day + ': ' + d.label + '</div><div class="lms-reading-day__sub">' + sub + '</div></div>' + link + '</div>';
      });
      html += '</div>';
    });

    // Completion check
    if (daysChecked.length >= 20) {
      html += '<div style="text-align:center;padding:1.5rem 0;"><div style="font-size:3rem;margin-bottom:0.5rem;">🎉</div><h3 style="font-family:var(--font-serif);font-size:1.2rem;margin:0 0 0.5rem;">Plan Complete!</h3><p style="font-size:0.85rem;color:var(--color-text-muted);margin:0 0 1rem;">You\'ve earned the "From Believer to Disciple" badge.</p><div class="lms-card__completion-badge">📖 From Believer to Disciple</div></div>';
      cp.completed = true;
      setCourseProgress(courseId, cp);
    }
    html += '</div>';
    deck.innerHTML = html;
    progressBar.style.width = Math.round((daysChecked.length / 20) * 100) + '%';
    pageNum.textContent = daysChecked.length + ' / 20 days completed';

    // Bind checkboxes
    deck.querySelectorAll('.lms-reading-day__check').forEach(function(el) {
      el.addEventListener('click', function() {
        var day = parseInt(this.dataset.day);
        var idx = daysChecked.indexOf(day);
        if (idx >= 0) daysChecked.splice(idx, 1);
        else daysChecked.push(day);
        cp.daysChecked = daysChecked;
        setCourseProgress(courseId, cp);
        render();
      });
    });
  }

  render();

  // Close
  function closeViewer() {
    viewer.classList.add('lms-viewer--closing');
    setTimeout(function() {
      viewer.remove();
      document.body.style.overflow = '';
      var container = document.getElementById('lms-catalog-root');
      if (container) renderCatalog(container);
    }, 250);
  }
  viewer.querySelector('.lms-viewer__close').addEventListener('click', closeViewer);
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { closeViewer(); document.removeEventListener('keydown', onKey); }
  });
}

// ═══════════════════════════════════════════════════════════════
// QUIZ INTERACTIONS
// ═══════════════════════════════════════════════════════════════
function bindQuizzes(card) {
  card.querySelectorAll('.lms-quiz').forEach(function(quiz) {
    var options = quiz.querySelectorAll('.lms-quiz__option');
    var answered = false;
    options.forEach(function(opt) {
      opt.addEventListener('click', function() {
        if (answered) return;
        answered = true;
        var isCorrect = this.dataset.answer === 'correct';
        this.classList.add(isCorrect ? 'lms-quiz__option--correct' : 'lms-quiz__option--wrong');
        // Show correct if wrong
        if (!isCorrect) {
          options.forEach(function(o) { if (o.dataset.answer === 'correct') o.classList.add('lms-quiz__option--correct'); });
        }
        // Add feedback
        var fb = document.createElement('div');
        fb.className = 'lms-quiz__feedback ' + (isCorrect ? 'lms-quiz__feedback--correct' : 'lms-quiz__feedback--wrong');
        fb.textContent = isCorrect ? '✓ Correct!' : '✗ Not quite — see the correct answer highlighted above.';
        quiz.appendChild(fb);
      });
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// PROFILE BADGES INTEGRATION
// ═══════════════════════════════════════════════════════════════
function updateProfileBadges() {
  var badges = document.getElementById('profile-badges');
  if (!badges) return;
  var session = null;
  try { session = JSON.parse(localStorage.getItem('stwm-team-session')); } catch(e) {}
  if (!session) return;

  var b = [];
  // Scan milestones (existing)
  var scans = session.totalScans || 0;
  if (scans >= 5) b.push('🌱 Seed Starter');
  if (scans >= 25) b.push('📖 Word Sower');
  if (scans >= 100) b.push('🌾 Harvest Hand');
  if (scans >= 500) b.push('⭐ Ministry Veteran');

  // LMS course badges
  var earned = getEarnedBadges();
  earned.forEach(function(badge) { b.push(badge.icon + ' ' + badge.label); });

  badges.innerHTML = b.map(function(x) { return '<span class="badge badge--earned">' + x + '</span>'; }).join('');
}

// ═══════════════════════════════════════════════════════════════
// INIT — replaces old training tab content
// ═══════════════════════════════════════════════════════════════
function initLMS() {
  var trainingPanel = document.getElementById('tab-training');
  if (!trainingPanel) return;

  // Replace old content with LMS catalog
  trainingPanel.innerHTML = '<div id="lms-catalog-root"></div>';
  var container = document.getElementById('lms-catalog-root');
  renderCatalog(container);

  // Update profile badges
  updateProfileBadges();
}

// Hook into training tab click
var trainingTab = document.querySelector('[data-tab="training"]');
if (trainingTab) {
  trainingTab.addEventListener('click', function() {
    setTimeout(initLMS, 50);
  });
}

// Also init if training tab is already active
setTimeout(function() {
  var panel = document.getElementById('tab-training');
  if (panel && !panel.hidden) initLMS();
}, 500);

// Re-update profile badges on portal show
var portal = document.getElementById('view-portal');
if (portal) {
  var obs = new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      if (m.target.id === 'view-portal' && m.target.classList.contains('active')) {
        setTimeout(updateProfileBadges, 200);
      }
    });
  });
  obs.observe(portal, { attributes: true, attributeFilter: ['class'] });
}

})();
