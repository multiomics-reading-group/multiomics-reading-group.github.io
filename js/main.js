/* ============================================
   MULTIOMICS READING GROUP — Main JS
   ============================================ */

(function () {
  'use strict';

  // ---- Nav scroll effect ----
  const nav = document.querySelector('.nav');
  if (nav) {
    const onScroll = () => {
      nav.classList.toggle('scrolled', window.scrollY > 40);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ---- Mobile nav toggle ----
  const toggle = document.querySelector('.nav-toggle');
  const navLinks = document.querySelector('.nav-links');
  if (toggle && navLinks) {
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('open');
      navLinks.classList.toggle('open');
      document.body.style.overflow = navLinks.classList.contains('open') ? 'hidden' : '';
    });
    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        toggle.classList.remove('open');
        navLinks.classList.remove('open');
        document.body.style.overflow = '';
      });
    });
  }

  // ---- Intersection Observer for fade-up ----
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
  );

  document.querySelectorAll('.fade-up').forEach(el => observer.observe(el));

  // ---- Schedule rendering ----
  const upcomingContainer = document.getElementById('upcoming-talks');
  const pastContainer = document.getElementById('past-talks');

  if (upcomingContainer || pastContainer) {
    loadSchedule();
  }

  async function loadSchedule() {
    try {
      const res = await fetch('data/schedule.json');
      const data = await res.json();
      renderSchedule(data);
    } catch (err) {
      console.error('Failed to load schedule:', err);
      if (upcomingContainer) {
        upcomingContainer.innerHTML = '<p class="schedule-empty">Could not load schedule data.</p>';
      }
    }
  }

  function renderSchedule(data) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Flatten all talks with session info
    const allTalks = [];
    data.sessions.forEach(session => {
      session.talks.forEach(talk => {
        allTalks.push({ ...talk, session: session.name });
      });
    });

    // Split into upcoming and past
    const upcoming = allTalks
      .filter(t => new Date(t.date + 'T12:00:00') >= today)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    const past = allTalks
      .filter(t => new Date(t.date + 'T12:00:00') < today)
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    if (upcomingContainer) {
      if (upcoming.length === 0) {
        upcomingContainer.innerHTML = '<p class="schedule-empty">No upcoming talks scheduled yet. Check back soon!</p>';
      } else {
        upcomingContainer.innerHTML = upcoming.map((t, i) => renderTalkRow(t, i === 0)).join('');
      }
    }

    if (pastContainer) {
      if (past.length === 0) {
        pastContainer.innerHTML = '<p class="schedule-empty">No past talks yet.</p>';
      } else {
        // Group past talks by session
        const grouped = {};
        past.forEach(t => {
          const key = t.session || 'Other';
          if (!grouped[key]) grouped[key] = [];
          grouped[key].push(t);
        });

        let html = '';
        Object.entries(grouped).forEach(([session, talks]) => {
          html += `<div class="past-session-group">`;
          html += `<h3 class="past-session-label">${session}</h3>`;
          html += `<div class="schedule-list">`;
          html += talks.map(t => renderTalkRow(t, false)).join('');
          html += `</div></div>`;
        });
        pastContainer.innerHTML = html;
      }
    }

    // Re-observe any new fade-up elements
    document.querySelectorAll('.fade-up:not(.visible)').forEach(el => observer.observe(el));

    renderLocalTimes();
  }

  function renderTalkRow(talk, isNext) {
    const d = new Date(talk.date + 'T12:00:00');
    const month = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
    const day = d.getDate();
    const year = d.getFullYear();

    const isCancelled = talk.note && /cancel/i.test(talk.note);
    const isPostponed = talk.note && /postpone/i.test(talk.note);
    const isSkip = talk.note && /skip|holiday/i.test(talk.note);
    const isEmpty = !talk.title && !talk.speaker && !isSkip;

    let titleDisplay = talk.title || '';
    let noteDisplay = '';

    if (talk.note) {
      noteDisplay = `<span class="schedule-badge${isCancelled ? ' badge-cancelled' : ''}${isPostponed ? ' badge-postponed' : ''}">${talk.note}</span>`;
    }

    if (isEmpty && !talk.note) {
      titleDisplay = 'Open Slot';
      noteDisplay = `<span class="schedule-badge badge-open">Propose a Talk</span>`;
    }

    if (isSkip && !talk.title) {
      titleDisplay = talk.note;
      noteDisplay = '';
    }

    if (talk.paper && titleDisplay) {
      titleDisplay = `<a href="${talk.paper}" target="_blank" rel="noopener" class="schedule-paper-link">${titleDisplay}</a>`;
    }

    const speakerHtml = talk.speaker
      ? `<span class="schedule-speaker"><strong>${talk.speaker}</strong>${talk.affiliation ? ' · ' + talk.affiliation : ''}</span>`
      : '';

    const classes = [
      'schedule-item',
      isNext ? 'is-next' : '',
      isCancelled ? 'is-cancelled' : '',
      isSkip ? 'is-skip' : '',
    ].filter(Boolean).join(' ');

    return `
      <div class="${classes}">
        <div class="schedule-date">
          <span class="day">${day}</span>
          ${month} ${year}
        </div>
        <div class="schedule-info">
          <div class="schedule-title">${titleDisplay}</div>
          ${speakerHtml}
          ${noteDisplay}
        </div>
        <div class="schedule-time">
          11–12 PM EST
          <span class="schedule-local-time" data-date="${talk.date}"></span>
        </div>
      </div>`;
  }

  // ---- Convert EST times to visitor's local timezone ----
  function renderLocalTimes() {
    document.querySelectorAll('.schedule-local-time').forEach(el => {
      const dateStr = el.dataset.date;
      if (!dateStr) return;
      // 11 AM EST = 16:00 UTC
      const start = new Date(dateStr + 'T16:00:00Z');
      const end = new Date(dateStr + 'T17:00:00Z');
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      // Skip if visitor is in US Eastern
      if (/America\/(New_York|Toronto|Montreal|Detroit)/.test(tz)) return;
      const fmt = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const tzAbbr = start.toLocaleTimeString([], { timeZoneName: 'short' }).split(' ').pop();
      el.textContent = `${fmt(start)}–${fmt(end)} ${tzAbbr}`;
    });
  }

  // ---- Organizers rendering (if on organizers page) ----
  const organizersContainer = document.getElementById('organizers-grid');
  if (organizersContainer) {
    renderOrganizers();
  }

  function renderOrganizers() {
    const organizers = [
      {
        name: 'César Miguel Valdez Córdova',
        role: 'Co-host',
        affiliation: 'McGill / Mila',
        link: 'https://cmvcordova.com',
        initials: 'CV',
        photo: 'assets/cesar.jpg',
      },
      {
        name: 'Xinyu Yuan',
        role: 'Co-host',
        affiliation: 'Mila / UdeM',
        link: '',
        initials: 'XY',
        photo: 'assets/xinyu.jpg',
      },
      {
        name: 'Dylan Mann-Krzisnik',
        role: 'Organizer',
        affiliation: 'McGill / Mila',
        link: 'https://sites.google.com/view/dylan-mk/home',
        initials: 'DM',
        photo: 'assets/dylan.jpg',
      },
      {
        name: 'Jiayao (Claris) Gu',
        role: 'Organizer',
        affiliation: 'McGill / Mila',
        link: '',
        initials: 'JG',
        photo: 'assets/claris.jpg',
      },
    ];

    organizersContainer.innerHTML = organizers.map(o => `
      <div class="organizer-card fade-up">
        <div class="organizer-avatar">${o.photo ? `<img src="${o.photo}" alt="${o.name}">` : o.initials}</div>
        <h3>${o.name}</h3>
        <div class="organizer-role">${o.role}</div>
        ${o.affiliation ? `<div class="organizer-affiliation">${o.affiliation}</div>` : ''}
        ${o.link ? `<a href="${o.link}" class="organizer-link" target="_blank" rel="noopener">${o.link.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a>` : ''}
      </div>
    `).join('');

    document.querySelectorAll('.fade-up:not(.visible)').forEach(el => observer.observe(el));
  }

  // ---- Past talks toggle ----
  const pastToggle = document.getElementById('past-toggle');
  const pastSection = document.getElementById('past-section');
  if (pastToggle && pastSection) {
    pastToggle.addEventListener('click', () => {
      const expanded = pastSection.getAttribute('aria-hidden') === 'false';
      pastSection.setAttribute('aria-hidden', expanded ? 'true' : 'false');
      pastToggle.setAttribute('aria-expanded', !expanded);
      pastToggle.querySelector('.toggle-text').textContent = expanded ? 'Show Past Talks' : 'Hide Past Talks';
      pastToggle.querySelector('.toggle-arrow').style.transform = expanded ? '' : 'rotate(180deg)';
    });
  }

})();
