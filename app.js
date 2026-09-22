/* ============================================================
   ABSENSI KARTU PELAJAR
   SMP & SMA BAITUL ULUM BOARDING SCHOOL

   APP.JS V20.7 - UNIFIED UI + PRESENSI GURU + DASHBOARD KEPALA SEKOLAH

   PERUBAHAN UTAMA:
   - LOGIN menggunakan USERNAME + PASSWORD biasa
   - TIDAK menggunakan SHA-256
   - TIDAK menggunakan PASSWORD_HASH
   - Password dikirim langsung ke Code.gs
   - Password dapat dikelola langsung melalui Sheet USER
   - Admin memiliki tombol REKAP BULANAN manual
   - Guru memiliki REKAP BULANAN per KELAS + MATA PELAJARAN
   - Rekap bulanan Admin tidak dijalankan saat scan
   - Rekap Guru hanya membaca data ABSENSI, tidak menulis REKAP_BULANAN
   - Setelah login, area scanner publik dan statistik publik disembunyikan

   KOMUNIKASI:
   fetch(API_URL)

   TIDAK menggunakan:
   google.script.run
============================================================ */


/* ============================================================
   1. KONFIGURASI
============================================================ */

const API_URL =
  'https://script.google.com/macros/s/AKfycbybMMhzrTv3Uqv3vMAdJTA5Co4FiTh_jZ4ocD5iNdHb2mZBX2S_BJJBrgFCgJIcqb21/exec';

const SESSION_KEY =
  'baitul_ulum_session_token';

const USER_KEY =
  'baitul_ulum_user';

const AUTO_SCAN_DELAY = 2500;

const REFRESH_INTERVAL = 30000;


/* ============================================================
   2. STATE
============================================================ */

let html5QrCode = null;

let scannerRunning = false;

let processingScan = false;

let currentUser = null;

let currentToken = null;

let currentTeacherSchedule = null;

let teacherSchedulesData = [];

let teacherRecapOptionsData = [];

let todayAttendanceData = [];

let refreshTimer = null;

let autoScanTimer = null;

let teacherAttendanceEditing = false;

let teacherAttendanceSaveAllRunning = false;
let teacherPresenceState = { checkingIn: false, lastResult: null };


/* ============================================================
   3. HELPER DOM
============================================================ */

function $(id) {
  return document.getElementById(id);
}


function exists(id) {
  return !!$(id);
}


function setText(id, value) {

  const element = $(id);

  if (!element) {
    return;
  }

  element.textContent =
    value === null ||
    value === undefined
      ? ''
      : String(value);
}


function show(id, display = '') {

  const element = $(id);

  if (!element) {
    return;
  }

  element.style.display = display;
}


function hide(id) {

  const element = $(id);

  if (!element) {
    return;
  }

  element.style.display = 'none';
}


function escapeHTML(value) {

  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}


/* ============================================================
   4. API HELPER
============================================================ */

async function apiGet(params = {}, options = {}) {

  const query =
    new URLSearchParams();


  Object.keys(params).forEach(
    function (key) {

      const value =
        params[key];

      if (
        value !== undefined &&
        value !== null &&
        value !== ''
      ) {

        query.append(
          key,
          String(value)
        );
      }

    }
  );


  /*
   * Cache buster
   */

  query.append(
    '_ts',
    String(Date.now())
  );


  const url =
    API_URL +
    '?' +
    query.toString();


  const timeoutMs =
    Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs)
      : 20000;


  try {

    const controller =
      new AbortController();


    const timeout =
      setTimeout(
        function () {

          controller.abort();

        },
        timeoutMs
      );


    let response;


    try {

      response =
        await fetch(
          url,
          {
            method: 'GET',
            cache: 'no-store',
            redirect: 'follow',
            credentials: 'omit',
            signal: controller.signal
          }
        );

    } finally {

      clearTimeout(timeout);

    }


    if (!response.ok) {

      throw new Error(
        'HTTP ' +
        response.status +
        ' ' +
        response.statusText
      );
    }


    const text =
      await response.text();


    if (!text) {

      throw new Error(
        'Server mengirim response kosong.'
      );
    }


    let data;


    try {

      data =
        JSON.parse(text);

    } catch (jsonError) {

      console.error(
        'Response Apps Script bukan JSON:',
        text.substring(0, 500)
      );

      throw new Error(
        'Server tidak mengembalikan JSON yang valid.'
      );
    }


    return data;


  } catch (error) {

    console.error(
      'API REQUEST ERROR:',
      error
    );


    if (
      error &&
      error.name === 'AbortError'
    ) {

      throw new Error(
        'Server terlalu lama merespons. Periksa koneksi internet.'
      );
    }


    if (
      error &&
      (
        error.name === 'TypeError' ||
        String(error.message)
          .toLowerCase()
          .includes('network')
      )
    ) {

      throw new Error(
        'Koneksi ke server absensi gagal. Periksa internet dan pastikan Web App Apps Script masih aktif.'
      );
    }


    throw error;
  }
}


/* ============================================================
   5. SESSION
============================================================ */

function loadStoredSession() {

  try {

    currentToken =
      localStorage.getItem(
        SESSION_KEY
      );


    const storedUser =
      localStorage.getItem(
        USER_KEY
      );


    if (storedUser) {

      try {

        currentUser =
          JSON.parse(
            storedUser
          );

      } catch (error) {

        currentUser = null;
      }
    }


  } catch (error) {

    console.error(
      'Gagal membaca session:',
      error
    );

    currentToken = null;

    currentUser = null;
  }
}


function saveSession(
  token,
  user
) {

  currentToken =
    token;

  currentUser =
    user;


  try {

    if (token) {

      localStorage.setItem(
        SESSION_KEY,
        token
      );
    }


    if (user) {

      localStorage.setItem(
        USER_KEY,
        JSON.stringify(user)
      );
    }


  } catch (error) {

    console.error(
      'Gagal menyimpan session:',
      error
    );
  }
}


function clearSession() {

  currentToken = null;

  currentUser = null;

  currentTeacherSchedule =
    null;


  try {

    localStorage.removeItem(
      SESSION_KEY
    );

    localStorage.removeItem(
      USER_KEY
    );

  } catch (error) {

    console.error(
      'Gagal menghapus session:',
      error
    );
  }
}


/* ============================================================
   6. BLOK DAFTAR ABSENSI PUBLIK
============================================================ */

function getTodayAttendanceBlock() {

  const primary =
    $('attendanceDesktop') ||
    $('attendanceMobile') ||
    $('attendanceTableBody') ||
    $('attendanceCardList');

  if (!primary) {
    return null;
  }

  const block =
    primary.closest(
      'section, .attendance-section, .dashboard-card, .dashboard-panel, .card, .panel'
    );

  return block || primary;
}


function setTodayAttendanceVisibility(visible) {

  const block =
    getTodayAttendanceBlock();

  if (block) {
    block.style.display =
      visible ? '' : 'none';
  }

  if (!block) {
    [
      'attendanceDesktop',
      'attendanceMobile',
      'attendanceEmpty',
      'attendanceLoading',
      'attendanceTotal',
      'attendanceDisplayInfo',
      'attendanceLimit'
    ].forEach(function(id) {

      const element = $(id);

      if (element) {
        element.style.display =
          visible ? '' : 'none';
      }
    });
  }

  if (visible) {
    updateTodayAttendanceLayout();
  }
}


function hideDashboardTodayAttendance() {
  setTodayAttendanceVisibility(false);
}


/* ============================================================
   6B. SEMBUNYIKAN AREA PUBLIK SETELAH LOGIN
============================================================ */

function findCommonPublicSummaryBlock() {

  const ids = [
    'countTotal',
    'countPresent',
    'countLate',
    'countAlready'
  ];

  const first = ids
    .map(function(id) { return $(id); })
    .find(Boolean);

  if (!first) return null;

  let node = first;

  while (node && node !== document.body) {

    let containsAll = true;

    for (const id of ids) {
      if (!node.querySelector || !node.querySelector('#' + id)) {
        containsAll = false;
        break;
      }
    }

    if (containsAll) return node;

    node = node.parentElement;
  }

  return null;
}


function setPublicScannerAreaVisibility(visible) {

  const ids = [
    'scannerCard',
    'result'
  ];

  ids.forEach(function(id) {
    const element = $(id);
    if (element) {
      if (visible) {
        element.style.display = id === 'scannerCard' ? 'block' : 'none';
      } else {
        element.style.display = 'none';
      }
    }
  });

  const summaryBlock = findCommonPublicSummaryBlock();

  if (summaryBlock) {
    summaryBlock.style.display = visible ? '' : 'none';
  }

  if (!visible) {
    clearTimeout(autoScanTimer);
    processingScan = false;

    if (html5QrCode || scannerRunning) {
      stopScanner().catch(function(error) {
        console.warn('Stop scanner saat login:', error);
      });
    }
  }
}


/* ============================================================
   7. LAYOUT ABSENSI PUBLIK
============================================================ */

function updateTodayAttendanceLayout() {

  const desktop = $('attendanceDesktop');
  const mobile = $('attendanceMobile');

  const isMobile =
    window.matchMedia
      ? window.matchMedia('(max-width: 700px)').matches
      : window.innerWidth <= 700;

  const dashboard = $('dashboard');
  const dashboardVisible =
    dashboard &&
    dashboard.style.display !== 'none';

  if (dashboardVisible) {
    if (desktop) desktop.style.display = 'none';
    if (mobile) mobile.style.display = 'none';
    return;
  }

  if (desktop) {
    desktop.style.display =
      isMobile ? 'none' : 'block';
  }

  if (mobile) {
    mobile.style.display =
      isMobile ? 'block' : 'none';
  }
}


/* ============================================================
   8. CEK SESSION
============================================================ */


async function checkSession() {

  loadStoredSession();


  if (!currentToken) {

    hideDashboard();

    return false;
  }


  try {

    const result =
      await apiGet({

        action:
          'checkSession',

        token:
          currentToken

      });


    if (
      result &&
      result.success &&
      result.status !==
        'SESSION_EXPIRED'
    ) {

      if (result.user) {

        currentUser =
          result.user;


        try {

          localStorage.setItem(
            USER_KEY,
            JSON.stringify(
              currentUser
            )
          );

        } catch (error) {}
      }


      showDashboard();

      return true;
    }


    clearSession();

    closePrincipalTeacherAttendanceCenter();
    hideDashboard();

    return false;


  } catch (error) {

    console.warn(
      'Check session gagal:',
      error
    );


    /*
     * Jika internet sementara bermasalah,
     * jangan langsung menghapus session.
     */

    if (currentUser) {

      showDashboard();

      return true;
    }


    hideDashboard();

    return false;
  }
}


/* ============================================================
   7. LOGIN MODAL
============================================================ */

function openLoginModal() {

  const modal =
    $('loginModal');


  if (!modal) {
    return;
  }


  modal.style.display =
    'flex';


  const message =
    $('loginMessage');


  if (message) {

    message.textContent =
      '';

    message.className =
      'login-message';
  }


  const username =
    $('loginUsername');


  if (username) {

    setTimeout(
      function () {

        username.focus();

      },
      100
    );
  }
}


function closeLoginModal() {

  const modal =
    $('loginModal');


  if (modal) {

    modal.style.display =
      'none';
  }
}


function showLoginMessage(
  text,
  type = 'error'
) {

  const message =
    $('loginMessage');


  if (!message) {
    return;
  }


  message.textContent =
    text;


  message.className =
    'login-message ' +
    type;
}


/* ============================================================
   8. LOGIN
============================================================ */

/*
 * LOGIN SEDERHANA
 *
 * Tidak ada:
 * - SHA-256
 * - crypto.subtle
 * - password hash
 *
 * Yang dikirim:
 * username
 * password
 */

async function loginUser() {

  const usernameInput =
    $('loginUsername');

  const passwordInput =
    $('loginPassword');


  if (
    !usernameInput ||
    !passwordInput
  ) {

    console.error(
      'Elemen login tidak ditemukan.'
    );

    return;
  }


  const username =
    usernameInput.value.trim();


  const password =
    passwordInput.value.trim();


  if (!username) {

    showLoginMessage(
      '⚠️ Username wajib diisi.',
      'error'
    );


    usernameInput.focus();

    return;
  }


  if (!password) {

    showLoginMessage(
      '⚠️ Password wajib diisi.',
      'error'
    );


    passwordInput.focus();

    return;
  }


  showLoginMessage(
    '⏳ Memeriksa username dan password...',
    'loading'
  );


  /*
   * ========================================================
   * PENTING
   *
   * Password dikirim LANGSUNG.
   *
   * Code.gs harus membaca:
   *
   * e.parameter.username
   * e.parameter.password
   *
   * dan mencocokkannya dengan kolom PASSWORD
   * pada Sheet USER.
   * ========================================================
   */

  try {

    const result =
      await apiGet({

        action:
          'login',

        username:
          username,

        password:
          password

      });


    console.log(
      'LOGIN RESPONSE:',
      result
    );


    if (!result) {

      showLoginMessage(
        '❌ Server tidak memberikan response.',
        'error'
      );

      return;
    }


    /*
     * LOGIN BERHASIL
     */

    if (
      result.success === true &&
      (
        result.status === 'LOGIN_SUCCESS' ||
        result.status === 'SUCCESS'
      )
    ) {

      if (
        !result.token
      ) {

        showLoginMessage(
          '❌ Login berhasil tetapi token sesi tidak diterima server.',
          'error'
        );

        return;
      }


      saveSession(
        result.token,
        result.user || {
          username:
            username
        }
      );


      passwordInput.value =
        '';


      showLoginMessage(
        '✅ Login berhasil.',
        'success'
      );


      setTimeout(
        function () {

          closeLoginModal();

          showDashboard();

        },
        300
      );


      return;
    }


    /*
     * LOGIN GAGAL
     */

    const serverMessage =
      result.message ||
      'Username atau password salah.';


    showLoginMessage(
      '❌ ' +
      serverMessage,
      'error'
    );


  } catch (error) {

    console.error(
      'LOGIN ERROR:',
      error
    );


    showLoginMessage(
      '🔴 ' +
      (
        error.message ||
        'Tidak dapat terhubung ke server.'
      ),
      'error'
    );
  }
}


/* ============================================================
   9. LOGOUT
============================================================ */

async function logoutUser() {

  const token =
    currentToken;


  try {

    if (token) {

      await apiGet({

        action:
          'logout',

        token:
          token

      });
    }


  } catch (error) {

    console.warn(
      'Logout server gagal:',
      error
    );


  } finally {

    clearSession();

    hideDashboard();


    currentTeacherSchedule =
      null;


    teacherSchedulesData =
      [];


    const schedules =
      $('teacherSchedules');


    if (schedules) {

      schedules.innerHTML =
        '';
    }


    const panel =
      $('teacherAttendancePanel');


    if (panel) {

      panel.style.display =
        'none';
    }


    openLoginModal();
  }
}


/* ============================================================
   10. SESSION EXPIRED
============================================================ */

function handleSessionExpired() {

  clearSession();

  closeAdminWhatsAppCenter();
  closePrincipalTeacherAttendanceCenter();
  hideDashboard();


  openLoginModal();


  showLoginMessage(
    '⚠️ Sesi login telah berakhir. Silakan login kembali.',
    'error'
  );
}


/* ============================================================
   10B. FOOTER APLIKASI
============================================================ */

const APP_NAME = 'ABSENSI KARTU PELAJAR';
const APP_VERSION = 'V13.0';
const APP_AUTHOR = 'SMP & SMA Baitul Ulum Boarding School';
const APP_YEAR = '2026';


function injectAppFooter() {

  if ($('appFooter')) {
    return;
  }

  const footer = document.createElement('footer');
  footer.id = 'appFooter';
  footer.className = 'app-footer';

  footer.innerHTML = `
    <div class="app-footer-name">${escapeHTML(APP_NAME)}</div>
    <div class="app-footer-meta">
      Versi ${escapeHTML(APP_VERSION)} &nbsp;•&nbsp;
      Dibuat oleh ${escapeHTML(APP_AUTHOR)} &nbsp;•&nbsp;
      © ${escapeHTML(APP_YEAR)}
    </div>
  `;

  document.body.appendChild(footer);
}


/* ============================================================
   11. DASHBOARD
============================================================ */

function showDashboard() {

  closePrincipalTeacherAttendanceCenter();

  const dashboard =
    $('dashboard');


  if (!dashboard) {

    console.warn(
      'Element #dashboard tidak ditemukan.'
    );

    return;
  }


  dashboard.style.display =
    'block';


  hideDashboardTodayAttendance();
  setPublicScannerAreaVisibility(false);


  const title =
    $('dashboardTitle');


  const user =
    $('dashboardUser');


  const role =
    String(
      currentUser?.role ||
      ''
    ).toUpperCase();


  const nama =
    currentUser?.nama ||
    currentUser?.username ||
    'Pengguna';


  if (title) {

    title.textContent =
      role === 'ADMIN'
        ? 'Dashboard Administrator'
        : role === 'KEPALA_SEKOLAH'
          ? 'Dashboard Kepala Sekolah'
          : 'Dashboard Guru';
  }


  if (user) {

    user.textContent =
      nama +
      ' • ' +
      (
        role === 'ADMIN'
          ? 'ADMINISTRATOR'
          : role === 'KEPALA_SEKOLAH'
            ? 'KEPALA SEKOLAH'
            : 'GURU'
      );
  }


  injectPrincipalTeacherDashboardPanel();
  injectPrincipalTeacherAttendancePage();
  setPrincipalTeacherDashboardVisibility(role === 'KEPALA_SEKOLAH');
  setPrincipalTeacherStandaloneVisibility(false);
  resetPrincipalTeacherDashboard();

  injectAdminRecapPanel();
  setAdminRecapVisibility(role === 'ADMIN');

  injectAdminWhatsAppPanel();
  injectAdminWhatsAppButton();
  setAdminWhatsAppVisibility(false);
  setAdminWhatsAppButtonVisibility(role === 'ADMIN');

  injectTeacherRecapPanel();
  setTeacherRecapVisibility(role === 'GURU');
  resetTeacherRecapView();
  hideTeacherRecapDownload();
  hideAdminRecapDownload();

  loadTeacherSchedules();

  if (role === 'GURU') {
    loadTeacherRecapOptions();
  }
}


function hideDashboard() {

  const dashboard =
    $('dashboard');


  if (dashboard) {

    dashboard.style.display =
      'none';
  }


  const panel =
    $('teacherAttendancePanel');


  if (panel) {

    panel.style.display =
      'none';
  }


  setTodayAttendanceVisibility(true);
  setPublicScannerAreaVisibility(true);
  setAdminWhatsAppVisibility(false);
  setAdminWhatsAppButtonVisibility(false);
  waCenterStandaloneVisible = false;
  resetTeacherRecapView();
  hideTeacherRecapDownload();
  hideAdminRecapDownload();
  teacherAttendanceEditing = false;
}


/* ============================================================
   12. JADWAL GURU
============================================================ */

async function loadTeacherSchedules() {

  if (!currentToken) {
    return;
  }


  const container =
    $('teacherSchedules');


  if (!container) {
    return;
  }


  container.innerHTML =
    '<div class="app-loading">⏳ Memuat jadwal hari ini...</div>';


  try {

    const result =
      await apiGet({

        action:
          'teacherSchedules',

        token:
          currentToken

      });


    if (
      result?.status ===
      'SESSION_EXPIRED'
    ) {

      handleSessionExpired();

      return;
    }


    if (
      !result ||
      !result.success
    ) {

      container.innerHTML =
        '<div class="app-error">❌ ' +
        escapeHTML(
          result?.message ||
          'Jadwal tidak dapat dimuat.'
        ) +
        '</div>';

      return;
    }


    teacherSchedulesData =
      Array.isArray(
        result.data
      )
        ? result.data
        : [];


    renderTeacherSchedules(
      teacherSchedulesData
    );


  } catch (error) {

    console.error(
      'LOAD SCHEDULE ERROR:',
      error
    );


    container.innerHTML =
      '<div class="app-error">🔴 ' +
      escapeHTML(
        error.message ||
        'Gagal mengambil jadwal dari server.'
      ) +
      '</div>';
  }
}


function renderTeacherSchedules(
  schedules
) {

  const container =
    $('teacherSchedules');


  if (!container) {
    return;
  }


  if (!schedules.length) {

    container.innerHTML =
      '<div class="app-empty">📅 Tidak ada jadwal aktif hari ini.</div>';

    return;
  }


  container.innerHTML =
    schedules
      .map(
        function (
          schedule,
          index
        ) {

          const selected =
            currentTeacherSchedule &&
            String(
              currentTeacherSchedule.jadwalId
            ) ===
            String(
              schedule.jadwalId
            );


          return `

            <button
              type="button"
              class="teacher-schedule-card ${selected ? 'selected' : ''}"
              data-schedule-id="${escapeHTML(schedule.jadwalId)}"
            >

              <div class="schedule-number">
                ${index + 1}
              </div>

              <div class="schedule-main">

                <div class="schedule-time">
                  🕐
                  ${escapeHTML(schedule.jamMulai || '-')}
                  -
                  ${escapeHTML(schedule.jamSelesai || '-')}
                </div>

                <div class="schedule-mapel">
                  ${escapeHTML(schedule.mapel || '-')}
                </div>

                <div class="schedule-class">
                  🎓
                  ${escapeHTML(schedule.kelas || '-')}
                </div>

              </div>

              <div class="schedule-ke">
                Jam Ke-
                ${escapeHTML(schedule.jamKe || '-')}
              </div>

            </button>

          `;
        }
      )
      .join('');
}



/* ============================================================
   12B. PRESENSI GURU
   ============================================================ */
function ensureTeacherCheckInPanel() {
  const panel = $('teacherAttendancePanel');
  if (!panel) return null;
  let box = $('teacherPresenceCheckInBox');
  if (box) return box;
  box = document.createElement('div');
  box.id = 'teacherPresenceCheckInBox';
  box.className = 'teacher-presence-checkin-box';
  box.innerHTML = `
    <div class="teacher-presence-checkin-head">
      <div>
        <div class="teacher-presence-checkin-title">🧑‍🏫 Presensi Kehadiran Guru</div>
        <div id="teacherPresenceCheckInInfo" class="teacher-presence-checkin-info">Silakan melakukan check-in untuk jadwal ini.</div>
      </div>
      <div id="teacherPresenceStatus" class="teacher-presence-status belum">⚪ Belum Check-in</div>
    </div>
    <div class="teacher-presence-checkin-actions">
      <button type="button" id="teacherCheckInButton" class="teacher-checkin-button">🟢 Check-in Kehadiran Guru</button>
      <span id="teacherCheckInMessage" class="teacher-checkin-message" aria-live="polite"></span>
    </div>`;
  panel.insertBefore(box, panel.firstElementChild || null);
  const button = $('teacherCheckInButton');
  if (button) button.addEventListener('click', handleTeacherCheckIn);
  return box;
}

function setTeacherCheckInMessage(text, type = '') {
  const el = $('teacherCheckInMessage');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'teacher-checkin-message' + (type ? ' ' + type : '');
}

function setTeacherPresenceStatus(status, result) {
  const el = $('teacherPresenceStatus');
  if (!el) return;
  const value = String(status || 'BELUM ABSEN').trim().toUpperCase();
  const map = {
    HADIR: ['🟢','hadir','HADIR'],
    TERLAMBAT: ['🟡','terlambat','TERLAMBAT'],
    IZIN: ['🔵','izin','IZIN'],
    SAKIT: ['🟣','sakit','SAKIT'],
    ALPA: ['🔴','alpa','ALPA']
  };
  const item = map[value] || ['⚪','belum','Belum Check-in'];
  el.className = 'teacher-presence-status ' + item[1];
  el.textContent = item[0] + ' ' + item[2];
  const info = $('teacherPresenceCheckInInfo');
  const presence = result && result.presence;
  if (info && presence) {
    info.textContent = 'Check-in ' + (presence.jam || presence.waktu || '-') + ' • ' + (presence.status || item[2]);
  }
}

function resetTeacherCheckInView() {
  teacherPresenceState.checkingIn = false;
  teacherPresenceState.lastResult = null;
  setTeacherPresenceStatus('BELUM ABSEN');
  setTeacherCheckInMessage('');
  const info = $('teacherPresenceCheckInInfo');
  if (info) info.textContent = 'Silakan melakukan check-in untuk jadwal ini.';
  const button = $('teacherCheckInButton');
  if (button) {
    button.disabled = false;
    button.textContent = '🟢 Check-in Kehadiran Guru';
  }
}

async function handleTeacherCheckIn() {
  if (!currentToken) {
    alert('⚠️ Sesi Guru belum tersedia. Silakan login kembali.');
    return;
  }
  if (!currentTeacherSchedule?.jadwalId) {
    alert('⚠️ Pilih jadwal mengajar terlebih dahulu.');
    return;
  }
  if (teacherPresenceState.checkingIn) return;

  const button = $('teacherCheckInButton');
  teacherPresenceState.checkingIn = true;
  if (button) {
    button.disabled = true;
    button.textContent = '⏳ Menyimpan presensi...';
  }
  setTeacherCheckInMessage('⏳ Mengirim presensi ke server...', 'loading');

  try {
    const result = await apiGet({
      action: 'teacherCheckIn',
      token: currentToken,
      jadwalId: currentTeacherSchedule.jadwalId
    });

    console.log('TEACHER CHECK-IN RESPONSE:', result);

    if (result?.status === 'SESSION_EXPIRED') {
      handleSessionExpired();
      return;
    }
    if (!result || !result.success) {
      throw new Error(result?.message || 'Presensi Guru gagal disimpan.');
    }

    teacherPresenceState.lastResult = result;
    const status = result.statusPresensi || result.presence?.status || result.statusGuru || 'HADIR';
    setTeacherPresenceStatus(status, result);

    const already = String(result.status || '').toUpperCase() === 'ALREADY';
    setTeacherCheckInMessage(
      already
        ? 'ℹ️ Presensi untuk jadwal ini sudah tercatat di GURU_ABSENSI.'
        : '✅ Presensi Guru berhasil disimpan ke GURU_ABSENSI.',
      'success'
    );

    if (button) {
      button.disabled = true;
      button.textContent = '✅ Presensi Tercatat';
    }
  } catch (error) {
    console.error('TEACHER CHECK-IN ERROR:', error);
    setTeacherCheckInMessage('❌ ' + (error.message || 'Gagal menyimpan presensi Guru.'), 'error');
    if (button) {
      button.disabled = false;
      button.textContent = '🟢 Coba Check-in Lagi';
    }
  } finally {
    teacherPresenceState.checkingIn = false;
  }
}

/* ============================================================
   13. PILIH JADWAL
============================================================ */

async function selectTeacherSchedule(
  jadwalId
) {

  const schedule =
    teacherSchedulesData.find(
      function (item) {

        return String(
          item.jadwalId
        ) ===
        String(
          jadwalId
        );
      }
    );


  if (!schedule) {
    return;
  }


  currentTeacherSchedule =
    schedule;


  renderTeacherSchedules(
    teacherSchedulesData
  );


  const panel =
    $('teacherAttendancePanel');


  if (panel) {

    panel.style.display =
      'block';
  }

  ensureTeacherCheckInPanel();
  resetTeacherCheckInView();



  setText(
    'teacherScheduleInfo',
    (
      schedule.jamMulai || '-'
    ) +
    ' - ' +
    (
      schedule.jamSelesai || '-'
    ) +
    ' • Jam Ke-' +
    (
      schedule.jamKe || '-'
    )
  );


  setText(
    'teacherClassTitle',
    schedule.kelas || '-'
  );


  setText(
    'teacherMapelTitle',
    schedule.mapel || '-'
  );


  await loadTeacherAttendance(
    schedule.jadwalId
  );
}


/* ============================================================
   14. ABSENSI KELAS GURU
============================================================ */

async function loadTeacherAttendance(
  jadwalId
) {

  if (!currentToken) {
    return;
  }


  const container =
    $('teacherStudentList');


  if (!container) {
    return;
  }


  container.innerHTML =
    '<div class="app-loading">⏳ Memuat data siswa...</div>';


  try {

    const result =
      await apiGet({

        action:
          'teacherAttendance',

        token:
          currentToken,

        jadwalId:
          jadwalId

      });


    if (
      result?.status ===
      'SESSION_EXPIRED'
    ) {

      handleSessionExpired();

      return;
    }


    if (
      !result ||
      !result.success
    ) {

      container.innerHTML =
        '<div class="app-error">❌ ' +
        escapeHTML(
          result?.message ||
          'Data absensi tidak dapat dimuat.'
        ) +
        '</div>';

      return;
    }


    renderTeacherStats(
      result
    );


    renderTeacherStudentList(
      result.data || []
    );


  } catch (error) {

    console.error(
      'TEACHER ATTENDANCE ERROR:',
      error
    );


    container.innerHTML =
      '<div class="app-error">🔴 ' +
      escapeHTML(
        error.message ||
        'Gagal mengambil absensi kelas.'
      ) +
      '</div>';
  }
}


/* ============================================================
   15. STATISTIK GURU
============================================================ */

function renderTeacherStats(
  result
) {

  const stats =
    $('teacherStats');


  if (!stats) {
    return;
  }


  stats.innerHTML = `

    <div class="teacher-stat">
      <span>👥 Total</span>
      <strong>${result.total || 0}</strong>
    </div>

    <div class="teacher-stat hadir">
      <span>🟢 Hadir</span>
      <strong>${result.hadir || 0}</strong>
    </div>

    <div class="teacher-stat terlambat">
      <span>🟡 Terlambat</span>
      <strong>${result.terlambat || 0}</strong>
    </div>

    <div class="teacher-stat izin">
      <span>🔵 Izin</span>
      <strong>${result.izin || 0}</strong>
    </div>

    <div class="teacher-stat sakit">
      <span>🟣 Sakit</span>
      <strong>${result.sakit || 0}</strong>
    </div>

    <div class="teacher-stat alpa">
      <span>🔴 Alpa</span>
      <strong>${result.alpa || 0}</strong>
    </div>

    <div class="teacher-stat belum">
      <span>⚪ Belum</span>
      <strong>${result.belum || 0}</strong>
    </div>

  `;
}


/* ============================================================
   16. DAFTAR SISWA GURU
============================================================ */

function renderTeacherStudentList(
  students
) {

  const container =
    $('teacherStudentList');


  if (!container) {
    return;
  }


  if (!students.length) {

    container.innerHTML =
      '<div class="app-empty">📭 Belum ada data siswa pada kelas ini.</div>';

    return;
  }


  container.innerHTML = `

    <div class="teacher-attendance-table-wrapper">

      <table class="teacher-attendance-table">

        <thead>

          <tr>
            <th>No</th>
            <th>Siswa</th>
            <th>Status</th>
            <th>Jam</th>
            <th>Catatan</th>
            <th>Aksi</th>
          </tr>

        </thead>

        <tbody>

          ${
            students
              .map(
                function (
                  student,
                  index
                ) {

                  const status =
                    student.status ||
                    'BELUM ABSEN';

                  const normalizedStatus =
                    String(status).trim().toUpperCase();

                  const selectedStatus =
                    normalizedStatus === 'BELUM ABSEN'
                      ? '__BELUM__'
                      : status;


                  return `

                    <tr
                      data-student-id="${escapeHTML(student.studentId)}"
                      data-original-status="${escapeHTML(status)}"
                      data-original-note="${escapeHTML(student.catatan || '')}"
                    >

                      <td class="teacher-rank">
                        ${index + 1}
                      </td>

                      <td>

                        <div class="teacher-student-name">
                          ${escapeHTML(student.nama || '-')}
                        </div>

                        <div class="teacher-student-id">
                          ${escapeHTML(student.studentId || '-')}
                        </div>

                      </td>

                      <td>

                        <select
                          class="attendance-status-select"
                          data-field="status"
                        >

                          <option value="__BELUM__"
                            ${selectedStatus === '__BELUM__' ? 'selected' : ''}>
                            ⚪ Belum Absen
                          </option>

                          <option value="Hadir"
                            ${selectedStatus === 'Hadir' ? 'selected' : ''}>
                            🟢 Hadir
                          </option>

                          <option value="Terlambat"
                            ${selectedStatus === 'Terlambat' ? 'selected' : ''}>
                            🟡 Terlambat
                          </option>

                          <option value="Izin"
                            ${selectedStatus === 'Izin' ? 'selected' : ''}>
                            🔵 Izin
                          </option>

                          <option value="Sakit"
                            ${selectedStatus === 'Sakit' ? 'selected' : ''}>
                            🟣 Sakit
                          </option>

                          <option value="Alpa"
                            ${selectedStatus === 'Alpa' ? 'selected' : ''}>
                            🔴 Alpa
                          </option>

                          <option value="Kegiatan"
                            ${selectedStatus === 'Kegiatan' ? 'selected' : ''}>
                            🟠 Kegiatan
                          </option>

                        </select>

                      </td>

                      <td>
                        ${escapeHTML(student.jam || '-')}
                      </td>

                      <td>

                        <input
                          type="text"
                          class="attendance-note-input"
                          data-field="catatan"
                          value="${escapeHTML(student.catatan || '')}"
                          placeholder="Catatan..."
                        >

                      </td>

                      <td>

                        <button
                          type="button"
                          class="save-attendance-button"
                          data-action="save-attendance"
                        >
                          💾 Simpan
                        </button>

                      </td>

                    </tr>

                  `;

                }
              )
              .join('')
          }

        </tbody>

      </table>

    </div>

    <div class="teacher-save-all-wrap">
      <button
        type="button"
        class="teacher-save-all-button"
        data-action="save-all-attendance"
      >
        💾 Simpan Semua
      </button>
      <span class="teacher-save-all-hint">
        Hanya siswa yang status/catatannya berubah yang akan disimpan.
      </span>
    </div>

  `;
}


/* ============================================================
   17. SIMPAN ABSENSI GURU
============================================================ */

async function saveTeacherAttendance(
  row
) {

  if (
    !row ||
    !currentTeacherSchedule ||
    !currentToken
  ) {
    return;
  }


  const studentId =
    row.dataset.studentId;


  const statusSelect =
    row.querySelector(
      '[data-field="status"]'
    );


  const noteInput =
    row.querySelector(
      '[data-field="catatan"]'
    );


  const saveButton =
    row.querySelector(
      '[data-action="save-attendance"]'
    );


  if (
    !studentId ||
    !statusSelect
  ) {
    return;
  }


  const status =
    statusSelect.value;

  if (status === '__BELUM__') {
    alert('⚠️ Silakan pilih status absensi terlebih dahulu.');
    return;
  }


  const catatan =
    noteInput
      ? noteInput.value.trim()
      : '';


  if (saveButton) {

    saveButton.disabled =
      true;

    saveButton.textContent =
      '⏳ Menyimpan...';
  }


  try {

    const result =
      await apiGet({

        action:
          'updateAttendance',

        token:
          currentToken,

        jadwalId:
          currentTeacherSchedule.jadwalId,

        studentId:
          studentId,

        status:
          status,

        catatan:
          catatan

      });


    if (
      result?.status ===
      'SESSION_EXPIRED'
    ) {

      handleSessionExpired();

      return;
    }


    if (
      result &&
      result.success &&
      result.status ===
        'UPDATED'
    ) {

      if (saveButton) {

        saveButton.textContent =
          '✅ Tersimpan';

        saveButton.disabled = true;
      }

      row.dataset.originalStatus = status;
      row.dataset.originalNote = catatan;
      row.classList.remove('teacher-row-dirty');
      teacherAttendanceEditing = false;

      updateTeacherRowSavedState(row, result);

      return;
    }


    throw new Error(
      result?.message ||
      'Absensi gagal diperbarui.'
    );


  } catch (error) {

    console.error(
      'UPDATE ATTENDANCE ERROR:',
      error
    );


    alert(
      '❌ Gagal menyimpan absensi.\n\n' +
      (
        error.message ||
        'Terjadi kesalahan server.'
      )
    );


    if (saveButton) {

      saveButton.disabled =
        false;

      saveButton.textContent =
        '💾 Simpan';
    }
  }
}


/* ============================================================
   18. EVENT DAFTAR SISWA
============================================================ */

function updateTeacherRowSavedState(row, result) {

  if (!row) return;

  const saveButton = row.querySelector('[data-action="save-attendance"]');
  const statusSelect = row.querySelector('[data-field="status"]');
  const noteInput = row.querySelector('[data-field="catatan"]');

  if (statusSelect && result?.attendance?.status) {
    statusSelect.value = result.attendance.status;
  }

  if (noteInput && result?.attendance?.catatan !== undefined) {
    noteInput.value = result.attendance.catatan || '';
  }

  if (saveButton) {
    saveButton.textContent = '✅ Tersimpan';
    saveButton.disabled = true;
  }
}


function getTeacherAttendanceRows() {
  const container = $('teacherStudentList');
  if (!container) return [];
  return Array.from(container.querySelectorAll('tr[data-student-id]'));
}


function getTeacherRowPayload(row) {
  const statusSelect = row.querySelector('[data-field="status"]');
  const noteInput = row.querySelector('[data-field="catatan"]');

  const studentId = row.dataset.studentId || '';
  const status = statusSelect ? statusSelect.value : '__BELUM__';
  const catatan = noteInput ? noteInput.value.trim() : '';
  const originalStatus = row.dataset.originalStatus || 'BELUM ABSEN';
  const originalNote = row.dataset.originalNote || '';

  if (!studentId || status === '__BELUM__') return null;

  const normalizedOriginal = String(originalStatus).trim().toUpperCase();
  const changed =
    String(status).trim().toUpperCase() !== normalizedOriginal ||
    catatan !== originalNote;

  if (!changed) return null;

  return {
    row: row,
    studentId: studentId,
    status: status,
    catatan: catatan
  };
}


async function saveAllTeacherAttendance() {

  if (teacherAttendanceSaveAllRunning) return;

  if (!currentToken || !currentTeacherSchedule) {
    alert('⚠️ Sesi atau jadwal Guru belum tersedia.');
    return;
  }

  const rows = getTeacherAttendanceRows();
  const pending = rows
    .map(getTeacherRowPayload)
    .filter(Boolean);

  if (!pending.length) {
    alert('ℹ️ Tidak ada perubahan yang perlu disimpan.');
    return;
  }

  const confirmed = window.confirm(
    'Simpan perubahan absensi untuk ' + pending.length + ' siswa?\n\n' +
    'Hanya baris yang status atau catatannya berubah yang akan diproses.'
  );

  if (!confirmed) return;

  const button = document.querySelector('[data-action="save-all-attendance"]');
  teacherAttendanceSaveAllRunning = true;
  teacherAttendanceEditing = false;

  if (button) {
    button.disabled = true;
    button.textContent = '⏳ Menyimpan 0/' + pending.length + '...';
  }

  let saved = 0;
  let failed = 0;

  try {

    for (const item of pending) {

      try {

        const result = await apiGet({
          action: 'updateAttendance',
          token: currentToken,
          jadwalId: currentTeacherSchedule.jadwalId,
          studentId: item.studentId,
          status: item.status,
          catatan: item.catatan
        });

        if (result?.status === 'SESSION_EXPIRED') {
          handleSessionExpired();
          return;
        }

        if (!result || !result.success || result.status !== 'UPDATED') {
          throw new Error(result?.message || 'Gagal menyimpan.');
        }

        updateTeacherRowSavedState(item.row, result);
        item.row.dataset.originalStatus = item.status;
        item.row.dataset.originalNote = item.catatan;
        item.row.classList.remove('teacher-row-dirty');
        saved++;

      } catch (itemError) {
        failed++;
        console.error('SAVE ALL ITEM ERROR:', item.studentId, itemError);
      }

      if (button) {
        button.textContent = '⏳ Menyimpan ' + (saved + failed) + '/' + pending.length + '...';
      }
    }

    if (failed === 0) {
      if (button) button.textContent = '✅ Semua Tersimpan';
      alert('✅ Semua perubahan berhasil disimpan (' + saved + ' siswa).');
    } else {
      if (button) button.textContent = '⚠️ ' + saved + ' tersimpan, ' + failed + ' gagal';
      alert(
        '⚠️ Proses selesai.\n\n' +
        'Berhasil: ' + saved + '\n' +
        'Gagal: ' + failed + '\n\n' +
        'Baris yang gagal tetap dapat disimpan kembali secara individual.'
      );
    }

  } finally {

    teacherAttendanceSaveAllRunning = false;

    setTimeout(function() {
      const currentButton = document.querySelector('[data-action="save-all-attendance"]');
      if (currentButton) {
        currentButton.disabled = false;
        currentButton.textContent = '💾 Simpan Semua';
      }
    }, 1200);
  }
}


function bindTeacherStudentEvents() {

  const container =
    $('teacherStudentList');


  if (!container) {
    return;
  }


  container.addEventListener(
    'click',
    function (event) {

      const saveAllButton =
        event.target.closest('[data-action="save-all-attendance"]');

      if (saveAllButton) {
        saveAllTeacherAttendance();
        return;
      }

      const button =
        event.target.closest(
          '[data-action="save-attendance"]'
        );


      if (!button) {
        return;
      }


      const row =
        button.closest('tr');


      if (!row) {
        return;
      }


      saveTeacherAttendance(
        row
      );
    }
  );

  container.addEventListener('input', function(event) {
    if (event.target.matches('[data-field="catatan"]')) {
      teacherAttendanceEditing = true;
      const row = event.target.closest('tr[data-student-id]');
      if (row) row.classList.add('teacher-row-dirty');
    }
  });

  container.addEventListener('change', function(event) {
    if (event.target.matches('[data-field="status"]')) {
      teacherAttendanceEditing = true;
      const row = event.target.closest('tr[data-student-id]');
      if (row) row.classList.add('teacher-row-dirty');
    }
  });
}


/* ============================================================
   19. SUMMARY
============================================================ */

async function loadTodaySummary() {

  try {

    const result =
      await apiGet({

        action:
          'summary'

      });


    if (
      !result ||
      !result.success
    ) {
      return;
    }


    setText(
      'countTotal',
      result.totalSiswa ??
      result.total ??
      0
    );


    setText(
      'countPresent',
      result.hadir ?? 0
    );


    setText(
      'countLate',
      result.terlambat ?? 0
    );


    setText(
      'countAlready',
      result.sudahAbsen ?? result.uniqueStudentCount ?? 0
    );


  } catch (error) {

    console.warn(
      'Summary gagal:',
      error
    );
  }
}


/* ============================================================
   20. ABSENSI HARI INI
============================================================ */

async function loadTodayAttendance() {

  const loading =
    $('attendanceLoading');


  const empty =
    $('attendanceEmpty');


  if (loading) {

    loading.style.display =
      'flex';
  }


  if (empty) {

    empty.style.display =
      'none';
  }


  try {

    let result;


    try {

      result =
        await apiGet({

          action:
            'todayAttendance'

        });


    } catch (error) {

      result =
        await apiGet({

          action:
            'todayAttendanceList'

        });
    }


    if (
      !result ||
      !result.success
    ) {

      throw new Error(
        result?.message ||
        'Data absensi tidak tersedia.'
      );
    }


    todayAttendanceData =
      Array.isArray(
        result.data
      )
        ? result.data
        : [];


    renderTodayAttendance();


  } catch (error) {

    console.warn(
      'TODAY ATTENDANCE ERROR:',
      error
    );


    todayAttendanceData =
      [];


    renderTodayAttendance();


  } finally {

    if (loading) {

      loading.style.display =
        'none';
    }
  }
}


/* ============================================================
   21. RENDER ABSENSI HARI INI
============================================================ */

function renderTodayAttendance() {

  const desktop =
    $('attendanceDesktop');


  const mobile =
    $('attendanceMobile');


  const empty =
    $('attendanceEmpty');


  const tbody =
    $('attendanceTableBody');


  const cardList =
    $('attendanceCardList');


  const total =
    todayAttendanceData.length;


  setText(
    'attendanceTotal',
    total
  );


  if (total === 0) {

    if (desktop) {

      desktop.style.display =
        'none';
    }


    if (mobile) {

      mobile.style.display =
        'none';
    }


    if (empty) {

      empty.style.display =
        'block';
    }


    setText(
      'attendanceDisplayInfo',
      'Belum ada siswa yang melakukan absensi hari ini.'
    );


    updateTodayAttendanceLayout();

    return;
  }


  if (empty) {

    empty.style.display =
      'none';
  }


  const limitSelect =
    $('attendanceLimit');


  const limit =
    limitSelect
      ? limitSelect.value
      : '10';


  let visibleData;


  if (limit === 'all') {

    visibleData =
      todayAttendanceData.slice();

  } else {

    const number =
      parseInt(
        limit,
        10
      );


    visibleData =
      todayAttendanceData.slice(
        0,
        isNaN(number)
          ? 10
          : number
      );
  }


  if (desktop) {

    desktop.style.display =
      'block';
  }


  if (tbody) {

    tbody.innerHTML =
      visibleData
        .map(
          function (
            item,
            index
          ) {

            const rank =
              item.rank ||
              item.urutan ||
              index + 1;


            return `

              <tr>

                <td>
                  ${getRankLabel(rank)}
                </td>

                <td>
                  <strong>
                    ${escapeHTML(item.nama || '-')}
                  </strong>
                </td>

                <td>
                  ${escapeHTML(item.kelas || '-')}
                </td>

                <td>
                  ${escapeHTML(item.jam || '-')}
                </td>

                <td>
                  ${getStatusBadge(item.status)}
                </td>

              </tr>

            `;
          }
        )
        .join('');
  }


  if (mobile) {

    mobile.style.display =
      'block';
  }


  if (cardList) {

    cardList.innerHTML =
      visibleData
        .map(
          function (
            item,
            index
          ) {

            const rank =
              item.rank ||
              item.urutan ||
              index + 1;


            return `

              <div class="attendance-card">

                <div class="attendance-card-rank">
                  ${getRankLabel(rank)}
                </div>

                <div class="attendance-card-content">

                  <div class="attendance-card-name">
                    ${escapeHTML(item.nama || '-')}
                  </div>

                  <div class="attendance-card-class">
                    ${escapeHTML(item.kelas || '-')}
                  </div>

                  <div class="attendance-card-bottom">

                    <span>
                      🕐
                      ${escapeHTML(item.jam || '-')}
                    </span>

                    <span>
                      ${getStatusBadge(item.status)}
                    </span>

                  </div>

                </div>

              </div>

            `;
          }
        )
        .join('');
  }


  setText(
    'attendanceDisplayInfo',

    limit === 'all'
      ? `Menampilkan semua ${total} siswa unik yang telah melakukan absensi.`
      : `Menampilkan ${visibleData.length} dari ${total} siswa unik yang telah melakukan absensi.`
  );

  updateTodayAttendanceLayout();
}


/* ============================================================
   22. RANK
============================================================ */

function getRankLabel(
  rank
) {

  const number =
    parseInt(
      rank,
      10
    );


  if (number === 1) {
    return '🥇';
  }


  if (number === 2) {
    return '🥈';
  }


  if (number === 3) {
    return '🥉';
  }


  return String(
    number || '-'
  );
}


/* ============================================================
   23. STATUS BADGE
============================================================ */

function getStatusBadge(
  status
) {

  const value =
    String(
      status || ''
    ).trim();


  let icon =
    '⚪';


  let className =
    'status-default';


  switch (
    value.toLowerCase()
  ) {

    case 'hadir':

      icon = '🟢';

      className =
        'status-hadir';

      break;


    case 'terlambat':

      icon = '🟡';

      className =
        'status-terlambat';

      break;


    case 'izin':

      icon = '🔵';

      className =
        'status-izin';

      break;


    case 'sakit':

      icon = '🟣';

      className =
        'status-sakit';

      break;


    case 'alpa':

      icon = '🔴';

      className =
        'status-alpa';

      break;


    case 'kegiatan':

      icon = '🟠';

      className =
        'status-kegiatan';

      break;


    case 'belum':
    case 'belum absen':

      icon = '⚪';

      className =
        'status-belum';

      break;
  }


  return `
    <span class="attendance-status-badge ${className}">
      ${icon} ${escapeHTML(value || 'Belum')}
    </span>
  `;
}


/* ============================================================
   24. TAMPILKAN SEMUA
============================================================ */

function showAllAttendance() {

  const select =
    $('attendanceLimit');


  if (select) {

    select.value =
      'all';
  }


  renderTodayAttendance();
}


window.showAllAttendance =
  showAllAttendance;

window.loadWACenterDashboard =
  loadWACenterDashboard;

window.sendManualWAMessageFromDashboard =
  sendManualWAMessageFromDashboard;

window.loadWAHistory =
  loadWAHistory;

window.resendWAFromDashboard =
  resendWAFromDashboard;


/* ============================================================
   25. TANGGAL & JAM
============================================================ */

function updateDateTime() {

  const now =
    new Date();


  const dateText =
    now.toLocaleDateString(
      'id-ID',
      {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric'
      }
    );


  const timeText =
    now.toLocaleTimeString(
      'id-ID',
      {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }
    );


  setText(
    'currentDate',
    dateText
  );


  setText(
    'currentTime',
    timeText
  );


  if (
    exists('attendanceDate')
  ) {

    setText(
      'attendanceDate',
      dateText
    );
  }
}


/* ============================================================
   26. SPEECH
============================================================ */

function prepareSpeech() {

  if (
    'speechSynthesis' in window
  ) {

    window.speechSynthesis.cancel();
  }
}


function speak(text) {

  if (
    !('speechSynthesis' in window)
  ) {
    return;
  }


  if (!text) {
    return;
  }


  try {

    window.speechSynthesis.cancel();


    const utterance =
      new SpeechSynthesisUtterance(
        text
      );


    utterance.lang =
      'id-ID';


    utterance.rate =
      0.9;


    utterance.pitch =
      1;


    window.speechSynthesis.speak(
      utterance
    );


  } catch (error) {

    console.warn(
      'Speech error:',
      error
    );
  }
}


/* ============================================================
   27. STATUS SCANNER
============================================================ */

function setStatus(
  text
) {

  const status =
    $('status');


  if (status) {

    status.textContent =
      text;
  }
}


/* ============================================================
   28. START SCANNER
============================================================ */

async function startScanner() {

  console.log(
    '=== START SCANNER ==='
  );


  processingScan =
    false;


  clearTimeout(
    autoScanTimer
  );


  hide('result');


  show(
    'scannerCard',
    'block'
  );


  setStatus(
    '📷 Memeriksa kamera...'
  );


  if (
    typeof Html5Qrcode ===
    'undefined'
  ) {

    setStatus(
      '🔴 Library scanner belum tersedia.'
    );


    console.error(
      'Html5Qrcode tidak ditemukan.'
    );


    return;
  }


  try {

    if (
      html5QrCode &&
      scannerRunning
    ) {

      await stopScanner();
    }


    await getCameraAndStart();


  } catch (error) {

    console.error(
      'START SCANNER ERROR:',
      error
    );


    setStatus(
      '🔴 Kamera tidak dapat digunakan. Pastikan izin kamera diberikan.'
    );
  }
}


/* ============================================================
   29. DETEKSI KAMERA
============================================================ */

async function getCameraAndStart() {

  setStatus(
    '📷 Meminta izin kamera...'
  );


  let cameras;


  try {

    cameras =
      await Html5Qrcode.getCameras();


  } catch (error) {

    console.error(
      'GET CAMERAS ERROR:',
      error
    );


    throw new Error(
      'Kamera tidak dapat diakses.'
    );
  }


  if (
    !cameras ||
    cameras.length === 0
  ) {

    throw new Error(
      'Tidak ada kamera ditemukan.'
    );
  }


  let selectedCamera =
    cameras.find(
      function (camera) {

        const label =
          String(
            camera.label || ''
          ).toLowerCase();


        return (
          label.includes('back') ||
          label.includes('rear') ||
          label.includes('environment') ||
          label.includes('belakang')
        );
      }
    );


  if (!selectedCamera) {

    selectedCamera =
      cameras[0];
  }


  console.log(
    'Camera:',
    selectedCamera.label
  );


  await startCamera(
    selectedCamera.id
  );
}


/* ============================================================
   30. START CAMERA
============================================================ */

async function startCamera(
  cameraId
) {

  const reader =
    $('reader');


  if (!reader) {

    throw new Error(
      'Element reader tidak ditemukan.'
    );
  }


  reader.innerHTML =
    '';


  html5QrCode =
    new Html5Qrcode(
      'reader'
    );


  const config = {

    fps: 10,


    qrbox:
      function (
        width,
        height
      ) {

        const minSize =
          Math.min(
            width,
            height
          );


        const boxSize =
          Math.floor(
            minSize * 0.70
          );


        return {

          width:
            Math.min(
              boxSize,
              300
            ),

          height:
            Math.min(
              boxSize,
              300
            )
        };
      },


    aspectRatio: 1.0,


    disableFlip: false
  };


  try {

    await html5QrCode.start(

      cameraId,

      config,

      onScanSuccess,

      onScanFailure

    );


    scannerRunning =
      true;


    setStatus(
      '🟢 SIAP SCAN KARTU'
    );


  } catch (error) {

    scannerRunning =
      false;


    console.error(
      'CAMERA START ERROR:',
      error
    );


    throw error;
  }
}


/* ============================================================
   31. SCAN FAILURE
============================================================ */

function onScanFailure(
  errorMessage
) {

  /*
   * Sengaja kosong.
   */
}


/* ============================================================
   32. SCAN SUCCESS
============================================================ */

async function onScanSuccess(
  decodedText
) {

  if (
    processingScan
  ) {
    return;
  }


  processingScan =
    true;


  const studentId =
    String(
      decodedText || ''
    ).trim();


  if (!studentId) {

    processingScan =
      false;

    return;
  }


  console.log(
    'QR TERBACA:',
    studentId
  );


  try {

    await stopScanner();

  } catch (error) {

    console.warn(
      'Stop scanner setelah scan:',
      error
    );
  }


  show(
    'result',
    'block'
  );


  hide(
    'scannerCard'
  );


  setText(
    'resultIcon',
    '⏳'
  );


  setText(
    'resultTitle',
    'MEMPROSES'
  );


  setText(
    'resultMessage',
    'Memeriksa data siswa...'
  );


  setText(
    'studentId',
    studentId
  );


  await processAttendance(
    studentId
  );
}


/* ============================================================
   33. PROSES ABSENSI
============================================================ */

async function processAttendance(
  studentId
) {

  try {

    const result =
      await apiGet({

        action:
          'attendance',

        studentId:
          studentId

      });


    console.log(
      'ATTENDANCE RESPONSE:',
      result
    );


    handleAttendanceResult(
      result
    );


  } catch (error) {

    console.error(
      'PROCESS ATTENDANCE ERROR:',
      error
    );


    showAttendanceError(
      'ERROR',
      error.message ||
      'Tidak dapat terhubung ke server.'
    );
  }
}


/* ============================================================
   34. HANDLE HASIL ABSENSI
============================================================ */

function handleAttendanceResult(
  result
) {

  if (!result) {

    showAttendanceError(
      'ERROR',
      'Server tidak memberikan response.'
    );

    return;
  }


  switch (
    String(
      result.status ||
      ''
    ).toUpperCase()
  ) {

    case 'SUCCESS':

      handleSuccess(
        result
      );

      break;


    case 'ALREADY':

      handleAlready(
        result
      );

      break;


    case 'NOT_FOUND':

      showAttendanceError(
        'NOT_FOUND',
        result.message ||
        'Data siswa tidak ditemukan.'
      );

      break;


    case 'INACTIVE':

      showAttendanceError(
        'INACTIVE',
        result.message ||
        'Siswa tidak aktif.'
      );

      break;


    case 'NO_SCHEDULE':

      showAttendanceError(
        'NO_SCHEDULE',
        result.message ||
        'Tidak ada jadwal aktif saat ini.'
      );

      break;


    default:

      showAttendanceError(
        'ERROR',
        result.message ||
        'Terjadi kesalahan pada absensi.'
      );
  }
}


/* ============================================================
   35. ABSENSI BERHASIL
============================================================ */

function handleSuccess(
  result
) {

  const student =
    result.student ||
    {};


  const attendance =
    result.attendance ||
    {};


  const status =
    result.attendanceStatus ||
    attendance.status ||
    'Hadir';


  const nama =
    student.nama ||
    '-';


  const kelas =
    student.kelas ||
    '-';


  const jam =
    attendance.jam ||
    '-';


  setText(
    'resultIcon',
    status === 'Terlambat'
      ? '🟡'
      : '✅'
  );


  setText(
    'resultTitle',
    status === 'Terlambat'
      ? 'TERLAMBAT'
      : 'ABSENSI BERHASIL'
  );


  setText(
    'resultMessage',
    nama +
    ' • Kelas ' +
    kelas +
    ' • ' +
    status +
    ' • Pukul ' +
    jam
  );


  setText(
    'studentId',
    student.studentId ||
    ''
  );


  if (
    status === 'Terlambat'
  ) {

    speak(
      'Absensi terlambat. ' +
      nama
    );

  } else {

    speak(
      'Absensi berhasil. ' +
      nama
    );
  }


  loadTodaySummary();

  loadTodayAttendance();


  scheduleNextScan();
}


/* ============================================================
   36. SUDAH ABSEN
============================================================ */

function handleAlready(
  result
) {

  const student =
    result.student ||
    {};


  const previous =
    result.previousAttendance ||
    {};


  const nama =
    student.nama ||
    '-';


  const kelas =
    student.kelas ||
    '-';


  const jam =
    previous.jam ||
    '-';


  const status =
    previous.status ||
    'Sudah Absen';


  setText(
    'resultIcon',
    '🟡'
  );


  setText(
    'resultTitle',
    'SUDAH ABSEN'
  );


  setText(
    'resultMessage',
    nama +
    ' • Kelas ' +
    kelas +
    ' • ' +
    status +
    ' • Absen pukul ' +
    jam
  );


  setText(
    'studentId',
    student.studentId ||
    ''
  );


  speak(
    'Sudah absen. ' +
    nama
  );


  loadTodaySummary();

  loadTodayAttendance();


  scheduleNextScan();
}


/* ============================================================
   37. ERROR ABSENSI
============================================================ */

function showAttendanceError(
  type,
  message
) {

  let icon =
    '🔴';


  let title =
    'TERJADI KESALAHAN';


  if (
    type === 'NOT_FOUND'
  ) {

    icon =
      '❓';


    title =
      'DATA TIDAK DITEMUKAN';


  } else if (
    type === 'INACTIVE'
  ) {

    icon =
      '⛔';


    title =
      'SISWA TIDAK AKTIF';


  } else if (
    type === 'NO_SCHEDULE'
  ) {

    icon =
      '📅';


    title =
      'TIDAK ADA JADWAL';
  }


  setText(
    'resultIcon',
    icon
  );


  setText(
    'resultTitle',
    title
  );


  setText(
    'resultMessage',
    message
  );


  if (
    type !== 'ERROR'
  ) {

    speak(title);
  }


  scheduleNextScan();
}


/* ============================================================
   38. STOP SCANNER
============================================================ */

async function stopScanner() {

  if (!html5QrCode) {

    scannerRunning =
      false;

    return;
  }


  try {

    if (scannerRunning) {

      await html5QrCode.stop();
    }


  } catch (error) {

    console.warn(
      'Scanner stop:',
      error
    );


  } finally {

    scannerRunning =
      false;


    try {

      html5QrCode.clear();

    } catch (error) {}


    html5QrCode =
      null;
  }
}


/* ============================================================
   39. RESTART SCANNER
============================================================ */

async function restartScanner() {

  clearTimeout(
    autoScanTimer
  );


  processingScan =
    false;


  await startScanner();
}


/* ============================================================
   40. AUTO SCAN
============================================================ */

function scheduleNextScan() {

  clearTimeout(
    autoScanTimer
  );


  const toggle =
    $('autoScanToggle');


  if (
    !toggle ||
    !toggle.checked
  ) {

    processingScan =
      false;

    return;
  }


  autoScanTimer =
    setTimeout(
      async function () {

        try {

          await restartScanner();

        } catch (error) {

          console.error(
            'AUTO SCAN ERROR:',
            error
          );

          processingScan =
            false;
        }

      },
      AUTO_SCAN_DELAY
    );
}


/* ============================================================
   41. LABEL AUTO SCAN
============================================================ */

function updateAutoScanLabel() {

  const toggle =
    $('autoScanToggle');


  const label =
    $('autoScanLabel');


  if (
    !toggle ||
    !label
  ) {
    return;
  }


  if (toggle.checked) {

    label.textContent =
      'AKTIF';

    label.style.color =
      '#16a34a';

  } else {

    label.textContent =
      'MATI';

    label.style.color =
      '#64748b';
  }
}



/* ============================================================
   41A. DASHBOARD KEPALA SEKOLAH
   ------------------------------------------------------------
   Menampilkan persentase kehadiran guru berdasarkan jadwal
   mengajar aktif pada rentang tanggal yang dipilih.

   Backend:
   - principalTeacherAttendance
   - principalTeacherDetail

   Rumus V1:
   (HADIR + TERLAMBAT) / TOTAL JADWAL AKTIF x 100%
   BELUM ABSEN belum dihitung sebagai ALPA.
============================================================ */

let principalTeacherStandaloneVisible = false;

let principalTeacherDashboardState = {
  loading: false,
  detailLoading: false,
  data: null,
  detailData: null,
  selectedGuruId: '',
  tanggalMulai: '',
  tanggalSelesai: ''
};


function getPrincipalDateRangeDefaults() {

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);

  return {
    tanggalMulai: formatDateInputValue(first),
    tanggalSelesai: formatDateInputValue(last)
  };
}


function formatDateInputValue(date) {

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');

  return y + '-' + m + '-' + d;
}


function setPrincipalTeacherDashboardMessage(text, type = '') {

  const el = $('principalTeacherDashboardMessage');

  if (!el) return;

  el.textContent = text || '';
  el.className =
    'principal-teacher-dashboard-message' +
    (type ? ' ' + type : '');
}


function resetPrincipalTeacherDashboard() {

  principalTeacherDashboardState.loading = false;
  principalTeacherDashboardState.detailLoading = false;
  principalTeacherDashboardState.data = null;
  principalTeacherDashboardState.detailData = null;
  principalTeacherDashboardState.selectedGuruId = '';

  const defaults =
    getPrincipalDateRangeDefaults();

  principalTeacherDashboardState.tanggalMulai =
    defaults.tanggalMulai;

  principalTeacherDashboardState.tanggalSelesai =
    defaults.tanggalSelesai;

  const start =
    $('principalTanggalMulai');

  const end =
    $('principalTanggalSelesai');

  if (start) {
    start.value =
      defaults.tanggalMulai;
  }

  if (end) {
    end.value =
      defaults.tanggalSelesai;
  }

  const result =
    $('principalTeacherDashboardResult');

  const detail =
    $('principalTeacherDetailResult');

  if (result) {
    result.style.display =
      'none';

    result.innerHTML =
      '';
  }

  if (detail) {
    detail.style.display =
      'none';

    detail.innerHTML =
      '';
  }

  setPrincipalTeacherDashboardMessage(
    '',
    ''
  );

  [
    $('principalLoadTeacherAttendanceButton'),
    $('principalLoadTeacherAttendanceButtonPage')
  ].forEach(function(button) {

    if (!button) return;

    button.disabled =
      false;

    button.textContent =
      '📊 Tampilkan Presensi Guru';

  });
}


function setPrincipalTeacherDashboardVisibility(visible) {

  const panel = $('principalTeacherDashboardPanel');

  if (!panel) return;

  panel.style.display = visible ? 'block' : 'none';

  if (!visible) {
    const detail = $('principalTeacherDetailResult');

    if (detail) {
      detail.style.display = 'none';
      detail.innerHTML = '';
    }
  }
}


function injectPrincipalTeacherDashboardPanel() {

  const dashboard = $('dashboard');

  if (!dashboard) return;

  if ($('principalTeacherDashboardPanel')) return;

  const panel = document.createElement('section');

  panel.id = 'principalTeacherDashboardPanel';
  panel.className = 'principal-teacher-dashboard-launcher';

  panel.innerHTML = `
    <div class="principal-launcher-icon">👔</div>

    <div class="principal-launcher-content">
      <div class="principal-launcher-kicker">
        MONITORING KEHADIRAN GURU
      </div>

      <div class="principal-launcher-title">
        Dashboard Kepala Sekolah
      </div>

      <div class="principal-launcher-subtitle">
        Pantau kehadiran guru berdasarkan jadwal mengajar pada periode yang dipilih.
      </div>
    </div>

    <button
      type="button"
      id="principalLoadTeacherAttendanceButton"
      class="principal-launcher-button"
    >
      📊 Tampilkan Presensi Guru
    </button>
  `;

  const userElement = $('dashboardUser');

  if (userElement && userElement.parentNode) {
    userElement.parentNode.insertBefore(
      panel,
      userElement.nextSibling
    );
  } else {
    dashboard.insertBefore(
      panel,
      dashboard.firstChild
    );
  }

  const button =
    $('principalLoadTeacherAttendanceButton');

  if (button) {
    button.addEventListener(
      'click',
      openPrincipalTeacherAttendanceCenter
    );
  }
}


function setPrincipalTeacherDashboardVisibility(visible) {

  const panel = $('principalTeacherDashboardPanel');

  if (!panel) return;

  panel.style.display = visible ? 'flex' : 'none';
}


function injectPrincipalTeacherAttendancePage() {

  if ($('principalTeacherAttendancePage')) return;

  const page = document.createElement('div');

  page.id = 'principalTeacherAttendancePage';
  page.className = 'principal-teacher-standalone-page';

  page.innerHTML = `
    <div class="principal-standalone-shell">

      <header class="principal-standalone-header">

        <div class="principal-standalone-header-left">

          <button
            type="button"
            id="principalTeacherBackButton"
            class="principal-standalone-back-button"
          >
            ← Kembali
          </button>

          <div class="principal-standalone-heading">
            <div class="principal-standalone-kicker">
              MONITORING KEHADIRAN GURU
            </div>

            <div class="principal-standalone-title">
              👔 Dashboard Kepala Sekolah
            </div>

            <div class="principal-standalone-subtitle">
              Monitoring presensi guru berdasarkan jadwal mengajar aktif.
            </div>
          </div>

        </div>

        <div class="principal-standalone-school">
          <div class="principal-standalone-school-name">
            ABSENSI KARTU PELAJAR
          </div>
          <div class="principal-standalone-school-meta">
            SMP &amp; SMA Baitul Ulum Boarding School
          </div>
        </div>

      </header>

      <main class="principal-standalone-content">

        <section class="principal-standalone-filter-card">

          <div class="principal-standalone-section-title">
            📅 Periode Monitoring
          </div>

          <div class="principal-standalone-filter-grid">

            <label class="principal-dashboard-field">
              <span>Tanggal Mulai</span>
              <input
                type="date"
                id="principalTanggalMulai"
              >
            </label>

            <label class="principal-dashboard-field">
              <span>Tanggal Selesai</span>
              <input
                type="date"
                id="principalTanggalSelesai"
              >
            </label>

            <button
              type="button"
              id="principalLoadTeacherAttendanceButtonPage"
              class="principal-standalone-primary-button"
            >
              📊 Tampilkan Presensi Guru
            </button>

          </div>

          <div
            id="principalTeacherDashboardMessage"
            class="principal-teacher-dashboard-message"
            aria-live="polite"
          ></div>

        </section>

        <section
          id="principalTeacherDashboardResult"
          class="principal-standalone-result"
          style="display:none;"
        ></section>

        <section
          id="principalTeacherDetailResult"
          class="principal-standalone-detail"
          style="display:none;"
        ></section>

      </main>

      <footer class="principal-standalone-footer">
        <div class="principal-standalone-footer-name">
          ABSENSI KARTU PELAJAR
        </div>
        <div class="principal-standalone-footer-meta">
          Dashboard Kepala Sekolah &nbsp;•&nbsp;
          Versi 20.6 &nbsp;•&nbsp;
          SMP &amp; SMA Baitul Ulum Boarding School &nbsp;•&nbsp;
          © 2026
        </div>
      </footer>

    </div>
  `;

  document.body.appendChild(page);

  const defaults =
    getPrincipalDateRangeDefaults();

  const start =
    $('principalTanggalMulai');

  const end =
    $('principalTanggalSelesai');

  if (start) {
    start.value =
      defaults.tanggalMulai;
  }

  if (end) {
    end.value =
      defaults.tanggalSelesai;
  }

  const backButton =
    $('principalTeacherBackButton');

  if (backButton) {
    backButton.addEventListener(
      'click',
      closePrincipalTeacherAttendanceCenterAndReturn
    );
  }

  const loadButton =
    $('principalLoadTeacherAttendanceButtonPage');

  if (loadButton) {
    loadButton.addEventListener(
      'click',
      loadPrincipalTeacherAttendance
    );
  }

  if (start) {
    start.addEventListener(
      'change',
      function() {

        if (
          end &&
          end.value &&
          start.value &&
          start.value > end.value
        ) {
          end.value =
            start.value;
        }

      }
    );
  }

  if (end) {
    end.addEventListener(
      'change',
      function() {

        if (
          start &&
          start.value &&
          end.value &&
          end.value < start.value
        ) {
          start.value =
            end.value;
        }

      }
    );
  }
}


function setPrincipalTeacherStandaloneVisibility(visible) {

  const page =
    $('principalTeacherAttendancePage');

  if (!page) return;

  page.style.display =
    visible ? 'block' : 'none';

  principalTeacherStandaloneVisible =
    Boolean(visible);

  document.body.classList.toggle(
    'principal-teacher-standalone-mode',
    Boolean(visible)
  );
}


async function openPrincipalTeacherAttendanceCenter() {

  const role =
    String(
      currentUser?.role || ''
    ).toUpperCase();

  if (
    !currentToken ||
    role !== 'KEPALA_SEKOLAH'
  ) {
    openLoginModal();
    return;
  }

  injectPrincipalTeacherAttendancePage();

  const dashboard =
    $('dashboard');

  if (dashboard) {
    dashboard.style.display =
      'none';
  }

  const globalFooter =
    $('appFooter');

  if (globalFooter) {
    globalFooter.style.display =
      'none';
  }

  setPublicScannerAreaVisibility(false);

  injectAppFooter();

  setPrincipalTeacherStandaloneVisibility(true);

  resetPrincipalTeacherDashboard();

  const pageButton =
    $('principalLoadTeacherAttendanceButtonPage');

  if (pageButton) {
    pageButton.disabled =
      false;

    pageButton.textContent =
      '📊 Tampilkan Presensi Guru';
  }

  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  });

  await loadPrincipalTeacherAttendance();
}


function closePrincipalTeacherAttendanceCenter() {

  principalTeacherStandaloneVisible =
    false;

  setPrincipalTeacherStandaloneVisibility(
    false
  );

  const detail =
    $('principalTeacherDetailResult');

  if (detail) {
    detail.style.display =
      'none';

    detail.innerHTML =
      '';
  }

  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  });
}


function closePrincipalTeacherAttendanceCenterAndReturn() {

  closePrincipalTeacherAttendanceCenter();

  if (
    currentToken &&
    String(
      currentUser?.role || ''
    ).toUpperCase() ===
      'KEPALA_SEKOLAH'
  ) {

    const dashboard =
      $('dashboard');

    if (dashboard) {
      dashboard.style.display =
        'block';
    }

    const globalFooter =
      $('appFooter');

    if (globalFooter) {
      globalFooter.style.display =
        '';
    }

    setPublicScannerAreaVisibility(
      false
    );

    setPrincipalTeacherDashboardVisibility(
      true
    );

    markPrincipalTodaySchedulePanels();

    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  }
}


function renderPrincipalSummaryCards(summary) {

  summary = summary || {};

  const totalJadwal =
    Number(summary.totalJadwal || 0);

  const totalHadir =
    Number(summary.totalHadir || 0);

  const totalTerlambat =
    Number(summary.totalTerlambat || 0);

  const totalIzin =
    Number(summary.totalIzin || 0);

  const totalSakit =
    Number(summary.totalSakit || 0);

  const totalAlpa =
    Number(summary.totalAlpa || 0);

  const totalMasuk =
    totalHadir +
    totalTerlambat;

  const percentage =
    totalJadwal > 0
      ? ((totalMasuk / totalJadwal) * 100).toFixed(2)
      : '0.00';

  return `
    <div class="principal-summary-grid">

      <div class="principal-summary-card">
        <div class="principal-summary-icon">📚</div>
        <div class="principal-summary-label">Total Jadwal</div>
        <div class="principal-summary-value">${totalJadwal}</div>
        <div class="principal-summary-note">jadwal guru aktif</div>
      </div>

      <div class="principal-summary-card hadir">
        <div class="principal-summary-icon">🟢</div>
        <div class="principal-summary-label">Hadir</div>
        <div class="principal-summary-value">${totalHadir}</div>
        <div class="principal-summary-note">check-in tepat waktu</div>
      </div>

      <div class="principal-summary-card terlambat">
        <div class="principal-summary-icon">🟡</div>
        <div class="principal-summary-label">Terlambat</div>
        <div class="principal-summary-value">${totalTerlambat}</div>
        <div class="principal-summary-note">tetap dihitung hadir</div>
      </div>

      <div class="principal-summary-card izin">
        <div class="principal-summary-icon">🔵</div>
        <div class="principal-summary-label">Izin</div>
        <div class="principal-summary-value">${totalIzin}</div>
        <div class="principal-summary-note">status pada presensi</div>
      </div>

      <div class="principal-summary-card sakit">
        <div class="principal-summary-icon">🟣</div>
        <div class="principal-summary-label">Sakit</div>
        <div class="principal-summary-value">${totalSakit}</div>
        <div class="principal-summary-note">status pada presensi</div>
      </div>

      <div class="principal-summary-card alpa">
        <div class="principal-summary-icon">🔴</div>
        <div class="principal-summary-label">Alpa</div>
        <div class="principal-summary-value">${totalAlpa}</div>
        <div class="principal-summary-note">status pada presensi</div>
      </div>

      <div class="principal-summary-card percentage">
        <div class="principal-summary-icon">📈</div>
        <div class="principal-summary-label">Kehadiran Efektif</div>
        <div class="principal-summary-value">${percentage}%</div>
        <div class="principal-summary-note">Hadir + Terlambat / Total Jadwal</div>
      </div>

    </div>
  `;
}


function renderPrincipalTeacherTable(teachers) {

  teachers = Array.isArray(teachers)
    ? teachers
    : [];

  if (!teachers.length) {
    return `
      <div class="principal-empty-state">
        <div class="principal-empty-icon">📭</div>
        <div class="principal-empty-title">Belum ada data jadwal guru</div>
        <div class="principal-empty-text">
          Tidak ditemukan jadwal aktif pada periode yang dipilih.
        </div>
      </div>
    `;
  }

  const rows = teachers.map(function(item, index) {

    const guruId =
      String(item.guruId || '');

    const guru =
      String(item.guru || 'Guru');

    const jadwal =
      Number(item.jadwal || 0);

    const hadir =
      Number(item.hadir || 0);

    const terlambat =
      Number(item.terlambat || 0);

    const izin =
      Number(item.izin || 0);

    const sakit =
      Number(item.sakit || 0);

    const alpa =
      Number(item.alpa || 0);

    const belumAbsen =
      Number(item.belumAbsen || 0);

    const persentase =
      Number(item.persentase || 0);

    const percentageClass =
      persentase >= 90
        ? 'good'
        : persentase >= 75
          ? 'warning'
          : 'danger';

    return `
      <tr>
        <td class="principal-rank">${index + 1}</td>
        <td>
          <div class="principal-guru-name">${escapeHTML(guru)}</div>
          <div class="principal-guru-id">${escapeHTML(guruId)}</div>
        </td>
        <td class="num">${jadwal}</td>
        <td class="num">${hadir}</td>
        <td class="num">${terlambat}</td>
        <td class="num">${izin}</td>
        <td class="num">${sakit}</td>
        <td class="num">${alpa}</td>
        <td class="num">${belumAbsen}</td>
        <td>
          <span class="principal-percentage ${percentageClass}">
            ${persentase.toFixed(2)}%
          </span>
        </td>
        <td>
          <button
            type="button"
            class="principal-detail-button"
            data-guru-id="${escapeHTML(guruId)}"
            data-guru-name="${escapeHTML(guru)}"
          >
            🔎 Detail
          </button>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div class="principal-table-wrap">
      <table class="principal-teacher-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Guru</th>
            <th>Jadwal</th>
            <th>Hadir</th>
            <th>Terlambat</th>
            <th>Izin</th>
            <th>Sakit</th>
            <th>Alpa</th>
            <th>Belum Absen</th>
            <th>Persentase</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}


function bindPrincipalTeacherDetailButtons() {

  const buttons =
    document.querySelectorAll(
      '.principal-detail-button'
    );

  buttons.forEach(function(button) {

    button.addEventListener(
      'click',
      function() {

        const guruId =
          button.getAttribute('data-guru-id') || '';

        const guruName =
          button.getAttribute('data-guru-name') || 'Guru';

        loadPrincipalTeacherDetail(
          guruId,
          guruName
        );
      }
    );
  });
}


async function loadPrincipalTeacherAttendance() {

  const role =
    String(currentUser?.role || '').toUpperCase();

  if (
    !currentToken ||
    role !== 'KEPALA_SEKOLAH'
  ) {
    setPrincipalTeacherDashboardMessage(
      '⛔ Dashboard ini hanya dapat diakses Kepala Sekolah.',
      'error'
    );
    return;
  }

  const start =
    $('principalTanggalMulai');

  const end =
    $('principalTanggalSelesai');

  const tanggalMulai =
    start
      ? String(start.value || '').trim()
      : '';

  const tanggalSelesai =
    end
      ? String(end.value || '').trim()
      : '';

  if (!tanggalMulai || !tanggalSelesai) {
    setPrincipalTeacherDashboardMessage(
      '⚠️ Tanggal mulai dan tanggal selesai wajib diisi.',
      'error'
    );
    return;
  }

  if (tanggalMulai > tanggalSelesai) {
    setPrincipalTeacherDashboardMessage(
      '⚠️ Tanggal mulai tidak boleh lebih besar dari tanggal selesai.',
      'error'
    );
    return;
  }

  const button =
    $('principalLoadTeacherAttendanceButtonPage') ||
    $('principalLoadTeacherAttendanceButton');

  if (button) {
    button.disabled = true;
    button.textContent = '⏳ Memuat data...';
  }

  principalTeacherDashboardState.loading = true;
  principalTeacherDashboardState.tanggalMulai =
    tanggalMulai;
  principalTeacherDashboardState.tanggalSelesai =
    tanggalSelesai;
  principalTeacherDashboardState.selectedGuruId = '';
  principalTeacherDashboardState.detailData = null;

  const detail =
    $('principalTeacherDetailResult');

  if (detail) {
    detail.style.display = 'none';
    detail.innerHTML = '';
  }

  setPrincipalTeacherDashboardMessage(
    '⏳ Mengambil jadwal dan presensi guru...',
    'loading'
  );

  try {

    const result =
      await apiGet(
        {
          action: 'principalTeacherAttendance',
          token: currentToken,
          tanggalMulai: tanggalMulai,
          tanggalSelesai: tanggalSelesai,
          guruId: ''
        },
        { timeoutMs: 120000 }
      );

    if (
      result?.status ===
      'SESSION_EXPIRED'
    ) {
      handleSessionExpired();
      return;
    }

    if (
      !result ||
      !result.success
    ) {
      throw new Error(
        result?.message ||
        'Data presensi guru gagal dimuat.'
      );
    }

    const data =
      result.data || {};

    principalTeacherDashboardState.data =
      data;

    const resultContainer =
      $('principalTeacherDashboardResult');

    if (resultContainer) {

      resultContainer.innerHTML = `
        ${renderPrincipalSummaryCards(data.summary)}
        <div class="principal-result-heading">
          <div>
            <div class="principal-result-title">
              Rekap Kehadiran Guru
            </div>
            <div class="principal-result-subtitle">
              ${escapeHTML(result.tanggalMulai || tanggalMulai)}
              s/d
              ${escapeHTML(result.tanggalSelesai || tanggalSelesai)}
            </div>
          </div>
          <div class="principal-result-badge">
            ${Array.isArray(data.teachers) ? data.teachers.length : 0} Guru
          </div>
        </div>
        ${renderPrincipalTeacherTable(data.teachers)}
      `;

      resultContainer.style.display = 'block';

      bindPrincipalTeacherDetailButtons();
    }

    setPrincipalTeacherDashboardMessage(
      '✅ Data presensi guru berhasil dimuat.',
      'success'
    );

  } catch (error) {

    console.error(
      'PRINCIPAL TEACHER ATTENDANCE ERROR:',
      error
    );

    const resultContainer =
      $('principalTeacherDashboardResult');

    if (resultContainer) {
      resultContainer.style.display = 'none';
      resultContainer.innerHTML = '';
    }

    setPrincipalTeacherDashboardMessage(
      '❌ ' +
      (
        error?.message ||
        'Gagal mengambil data presensi guru.'
      ),
      'error'
    );

  } finally {

    principalTeacherDashboardState.loading = false;

    if (button) {
      button.disabled = false;
      button.textContent =
        '📊 Tampilkan Presensi Guru';
    }
  }
}


function renderPrincipalDetailSummary(summary) {

  summary = summary || {};

  return `
    <div class="principal-detail-summary-grid">
      <div class="principal-detail-stat">
        <span>Total Jadwal</span>
        <strong>${Number(summary.totalJadwal || 0)}</strong>
      </div>
      <div class="principal-detail-stat hadir">
        <span>Hadir</span>
        <strong>${Number(summary.hadir || 0)}</strong>
      </div>
      <div class="principal-detail-stat terlambat">
        <span>Terlambat</span>
        <strong>${Number(summary.terlambat || 0)}</strong>
      </div>
      <div class="principal-detail-stat izin">
        <span>Izin</span>
        <strong>${Number(summary.izin || 0)}</strong>
      </div>
      <div class="principal-detail-stat sakit">
        <span>Sakit</span>
        <strong>${Number(summary.sakit || 0)}</strong>
      </div>
      <div class="principal-detail-stat alpa">
        <span>Alpa</span>
        <strong>${Number(summary.alpa || 0)}</strong>
      </div>
      <div class="principal-detail-stat belum">
        <span>Belum Absen</span>
        <strong>${Number(summary.belumAbsen || 0)}</strong>
      </div>
    </div>
  `;
}


function renderPrincipalDetailTable(jadwal) {

  jadwal = Array.isArray(jadwal)
    ? jadwal
    : [];

  if (!jadwal.length) {
    return `
      <div class="principal-empty-state">
        <div class="principal-empty-icon">📭</div>
        <div class="principal-empty-title">Tidak ada detail jadwal</div>
        <div class="principal-empty-text">
          Tidak ditemukan jadwal pada periode yang dipilih.
        </div>
      </div>
    `;
  }

  const rows = jadwal.map(function(item) {

    const status =
      String(item.status || 'BELUM ABSEN')
        .toUpperCase();

    let statusClass = 'belum';
    let statusText = 'BELUM ABSEN';

    if (status === 'HADIR') {
      statusClass = 'hadir';
      statusText = 'HADIR';
    } else if (status === 'TERLAMBAT') {
      statusClass = 'terlambat';
      statusText = 'TERLAMBAT';
    } else if (status === 'IZIN') {
      statusClass = 'izin';
      statusText = 'IZIN';
    } else if (status === 'SAKIT') {
      statusClass = 'sakit';
      statusText = 'SAKIT';
    } else if (status === 'ALPA') {
      statusClass = 'alpa';
      statusText = 'ALPA';
    }

    return `
      <tr>
        <td>${escapeHTML(item.tanggal || '')}</td>
        <td>${escapeHTML(item.hari || '')}</td>
        <td>${escapeHTML(item.jamKe || '')}</td>
        <td>
          ${escapeHTML(item.jamMulai || '')}
          -
          ${escapeHTML(item.jamSelesai || '')}
        </td>
        <td>${escapeHTML(item.kelas || '')}</td>
        <td>${escapeHTML(item.mapel || '')}</td>
        <td>
          <span class="principal-detail-status ${statusClass}">
            ${statusText}
          </span>
        </td>
        <td>${escapeHTML(item.jamCheckIn || '-')}</td>
        <td>${escapeHTML(item.metode || '-')}</td>
        <td>${escapeHTML(item.catatan || '-')}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="principal-detail-table-wrap">
      <table class="principal-detail-table">
        <thead>
          <tr>
            <th>Tanggal</th>
            <th>Hari</th>
            <th>Jam Ke</th>
            <th>Waktu</th>
            <th>Kelas</th>
            <th>Mapel</th>
            <th>Status</th>
            <th>Check-in</th>
            <th>Metode</th>
            <th>Catatan</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}


async function loadPrincipalTeacherDetail(
  guruId,
  guruName
) {

  const role =
    String(currentUser?.role || '').toUpperCase();

  if (
    !currentToken ||
    role !== 'KEPALA_SEKOLAH'
  ) {
    return;
  }

  guruId =
    String(guruId || '').trim();

  guruName =
    String(guruName || 'Guru').trim();

  if (!guruId) {
    setPrincipalTeacherDashboardMessage(
      '⚠️ GURU_ID tidak ditemukan.',
      'error'
    );
    return;
  }

  const detail =
    $('principalTeacherDetailResult');

  if (!detail) return;

  principalTeacherDashboardState.detailLoading = true;
  principalTeacherDashboardState.selectedGuruId =
    guruId;

  detail.style.display = 'block';

  detail.innerHTML = `
    <div class="principal-detail-loading">
      ⏳ Memuat detail presensi ${escapeHTML(guruName)}...
    </div>
  `;

  detail.scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });

  try {

    const result =
      await apiGet(
        {
          action: 'principalTeacherDetail',
          token: currentToken,
          guruId: guruId,
          tanggalMulai:
            principalTeacherDashboardState.tanggalMulai,
          tanggalSelesai:
            principalTeacherDashboardState.tanggalSelesai
        },
        { timeoutMs: 120000 }
      );

    if (
      result?.status ===
      'SESSION_EXPIRED'
    ) {
      handleSessionExpired();
      return;
    }

    if (
      !result ||
      !result.success
    ) {
      throw new Error(
        result?.message ||
        'Detail presensi guru gagal dimuat.'
      );
    }

    const data =
      result.data || {};

    principalTeacherDashboardState.detailData =
      data;

    detail.innerHTML = `
      <div class="principal-detail-header">
        <div>
          <div class="principal-detail-kicker">DETAIL GURU</div>
          <div class="principal-detail-title">
            👤 ${escapeHTML(guruName)}
          </div>
          <div class="principal-detail-subtitle">
            ${escapeHTML(guruId)}
            •
            ${escapeHTML(result.tanggalMulai || principalTeacherDashboardState.tanggalMulai)}
            s/d
            ${escapeHTML(result.tanggalSelesai || principalTeacherDashboardState.tanggalSelesai)}
          </div>
        </div>

        <button
          type="button"
          id="principalCloseTeacherDetailButton"
          class="principal-close-detail-button"
        >
          ✕ Tutup Detail
        </button>
      </div>

      ${renderPrincipalDetailSummary(data.summary)}

      ${renderPrincipalDetailTable(data.jadwal)}
    `;

    const closeButton =
      $('principalCloseTeacherDetailButton');

    if (closeButton) {
      closeButton.addEventListener(
        'click',
        function() {
          detail.style.display = 'none';
          detail.innerHTML = '';
        }
      );
    }

    setPrincipalTeacherDashboardMessage(
      '✅ Detail presensi ' +
      guruName +
      ' berhasil dimuat.',
      'success'
    );

  } catch (error) {

    console.error(
      'PRINCIPAL TEACHER DETAIL ERROR:',
      error
    );

    detail.innerHTML = `
      <div class="principal-detail-error">
        ❌ ${escapeHTML(
          error?.message ||
          'Gagal memuat detail presensi guru.'
        )}
      </div>
    `;

  } finally {

    principalTeacherDashboardState.detailLoading = false;
  }
}


/* ============================================================
   42. REKAP BULANAN GURU
   ------------------------------------------------------------
   Rekap hanya untuk kelas + mata pelajaran yang diajar Guru.
   Data dibaca dari ABSENSI dan tidak menulis REKAP_BULANAN.
============================================================ */

function resetTeacherRecapView() {

  const resultContainer = $('teacherRecapResult');
  const message = $('teacherRecapMessage');

  if (resultContainer) {
    resultContainer.style.display = 'none';
    resultContainer.innerHTML = '';
  }

  if (message) {
    message.textContent = '';
    message.className = 'teacher-recap-message';
  }
}


function injectTeacherRecapPanel() {

  const dashboard = $('dashboard');
  if (!dashboard) return;

  if ($('teacherMonthlyRecapPanel')) return;

  const panel = document.createElement('section');
  panel.id = 'teacherMonthlyRecapPanel';
  panel.className = 'teacher-monthly-recap-panel';

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const months = [
    'Januari','Februari','Maret','April','Mei','Juni',
    'Juli','Agustus','September','Oktober','November','Desember'
  ];

  panel.innerHTML = `
    <div class="teacher-recap-title">📊 Rekap Bulanan Guru</div>
    <div class="teacher-recap-subtitle">
      Pilih kelas dan mata pelajaran. Rekap dihitung per siswa berdasarkan hari, bukan jumlah jam pelajaran.
    </div>

    <div class="teacher-recap-controls">
      <label class="teacher-recap-field">
        <span>Bulan</span>
        <select id="teacherRecapMonth">
          ${months.map((name, i) => `
            <option value="${i + 1}" ${i + 1 === currentMonth ? 'selected' : ''}>${name}</option>
          `).join('')}
        </select>
      </label>

      <label class="teacher-recap-field">
        <span>Tahun</span>
        <select id="teacherRecapYear">
          ${Array.from({length: 5}, (_, i) => currentYear - 2 + i).map(year => `
            <option value="${year}" ${year === currentYear ? 'selected' : ''}>${year}</option>
          `).join('')}
        </select>
      </label>

      <label class="teacher-recap-field">
        <span>Kelas</span>
        <select id="teacherRecapClass">
          <option value="">⏳ Memuat kelas...</option>
        </select>
      </label>

      <label class="teacher-recap-field">
        <span>Mata Pelajaran</span>
        <select id="teacherRecapMapel">
          <option value="">Pilih kelas terlebih dahulu</option>
        </select>
      </label>

      <button
        type="button"
        id="teacherRebuildRecapButton"
        class="teacher-recap-button"
      >
        📊 Tampilkan Rekap
      </button>
    </div>

    <div id="teacherRecapMessage" class="teacher-recap-message" aria-live="polite"></div>

    <div id="teacherRecapDownloadWrap" class="teacher-recap-download-wrap" style="display:none;">
      <button
        type="button"
        id="teacherRecapDownloadButton"
        class="teacher-recap-download-button"
      >
        📥 Download Rekap Excel (.xlsx)
      </button>
      <span id="teacherRecapDownloadMessage" class="teacher-recap-download-message"></span>
    </div>

    <div id="teacherRecapResult" class="teacher-recap-result" style="display:none;"></div>
  `;

  const scheduleContainer = $('teacherSchedules');

  if (scheduleContainer && scheduleContainer.parentNode) {
    scheduleContainer.parentNode.insertBefore(panel, scheduleContainer.nextSibling);
  } else {
    const userElement = $('dashboardUser');
    if (userElement && userElement.parentNode) {
      userElement.parentNode.insertBefore(panel, userElement.nextSibling);
    } else {
      dashboard.insertBefore(panel, dashboard.firstChild);
    }
  }

  const button = $('teacherRebuildRecapButton');
  if (button) {
    button.addEventListener('click', loadTeacherMonthlyRecap);
  }

  const downloadButton = $('teacherRecapDownloadButton');
  if (downloadButton) {
    downloadButton.addEventListener('click', downloadTeacherMonthlyRecapXlsx);
  }

  const classSelect = $('teacherRecapClass');
  if (classSelect) {
    classSelect.addEventListener('change', function() {
      updateTeacherRecapMapelOptions();
      hideTeacherRecapDownload();
    });
  }

  const monthSelect = $('teacherRecapMonth');
  if (monthSelect) {
    monthSelect.addEventListener('change', hideTeacherRecapDownload);
  }

  const yearSelect = $('teacherRecapYear');
  if (yearSelect) {
    yearSelect.addEventListener('change', hideTeacherRecapDownload);
  }

  const mapelSelect = $('teacherRecapMapel');
  if (mapelSelect) {
    mapelSelect.addEventListener('change', hideTeacherRecapDownload);
  }
}


function setTeacherRecapVisibility(visible) {

  const panel = $('teacherMonthlyRecapPanel');
  if (!panel) return;

  panel.style.display = visible ? 'block' : 'none';
}


function setTeacherRecapMessage(text, type = '') {

  const element = $('teacherRecapMessage');
  if (!element) return;

  element.textContent = text || '';
  element.className =
    'teacher-recap-message' +
    (type ? ' ' + type : '');
}


async function loadTeacherRecapOptions() {

  if (!currentToken || String(currentUser?.role || '').toUpperCase() !== 'GURU') {
    return;
  }

  const classSelect = $('teacherRecapClass');
  const mapelSelect = $('teacherRecapMapel');

  if (!classSelect || !mapelSelect) return;

  classSelect.innerHTML = '<option value="">⏳ Memuat kelas...</option>';
  mapelSelect.innerHTML = '<option value="">Pilih kelas terlebih dahulu</option>';

  try {

    const result = await apiGet({
      action: 'teacherRecapOptions',
      token: currentToken
    });

    if (result?.status === 'SESSION_EXPIRED') {
      handleSessionExpired();
      return;
    }

    if (!result || !result.success) {
      throw new Error(result?.message || 'Pilihan kelas dan mata pelajaran tidak dapat dimuat.');
    }

    teacherRecapOptionsData = Array.isArray(result.data) ? result.data : [];

    const classMap = {};

    teacherRecapOptionsData.forEach(function(item) {
      const key = String(item.kelasId || item.kelas || '').trim();
      if (!key) return;
      if (!classMap[key]) {
        classMap[key] = {
          kelasId: item.kelasId || key,
          kelas: item.kelas || key
        };
      }
    });

    const classes = Object.values(classMap).sort(function(a, b) {
      return String(a.kelas).localeCompare(String(b.kelas), 'id', {numeric:true});
    });

    if (!classes.length) {
      classSelect.innerHTML = '<option value="">Tidak ada kelas</option>';
      mapelSelect.innerHTML = '<option value="">Tidak ada mata pelajaran</option>';
      setTeacherRecapMessage('📭 Belum ada jadwal aktif yang dapat direkap.', 'error');
      return;
    }

    classSelect.innerHTML =
      '<option value="">Pilih kelas</option>' +
      classes.map(function(item) {
        return '<option value="' + escapeHTML(item.kelasId) + '">' + escapeHTML(item.kelas) + '</option>';
      }).join('');

    mapelSelect.innerHTML = '<option value="">Pilih kelas terlebih dahulu</option>';
    setTeacherRecapMessage('');

  } catch (error) {

    console.error('TEACHER RECAP OPTIONS ERROR:', error);

    classSelect.innerHTML = '<option value="">Gagal memuat kelas</option>';
    mapelSelect.innerHTML = '<option value="">Gagal memuat</option>';
    setTeacherRecapMessage('❌ ' + (error.message || 'Gagal memuat pilihan rekap.'), 'error');
  }
}


function updateTeacherRecapMapelOptions() {

  const classSelect = $('teacherRecapClass');
  const mapelSelect = $('teacherRecapMapel');

  if (!classSelect || !mapelSelect) return;

  const kelasId = String(classSelect.value || '').trim();

  if (!kelasId) {
    mapelSelect.innerHTML = '<option value="">Pilih kelas terlebih dahulu</option>';
    return;
  }

  const mapelMap = {};

  teacherRecapOptionsData
    .filter(function(item) {
      return String(item.kelasId || '').trim() === kelasId;
    })
    .forEach(function(item) {
      const key = String(item.mapelId || item.mapel || '').trim();
      if (!key) return;
      if (!mapelMap[key]) {
        mapelMap[key] = {
          mapelId: item.mapelId || key,
          mapel: item.mapel || key
        };
      }
    });

  const mapels = Object.values(mapelMap).sort(function(a, b) {
    return String(a.mapel).localeCompare(String(b.mapel), 'id');
  });

  if (!mapels.length) {
    mapelSelect.innerHTML = '<option value="">Tidak ada mata pelajaran</option>';
    return;
  }

  mapelSelect.innerHTML =
    '<option value="">Pilih mata pelajaran</option>' +
    mapels.map(function(item) {
      return '<option value="' + escapeHTML(item.mapelId) + '">' + escapeHTML(item.mapel) + '</option>';
    }).join('');
}


function renderTeacherMonthlyRecap(result) {

  const container = $('teacherRecapResult');
  if (!container) return;

  const rows = Array.isArray(result?.data?.rows)
    ? result.data.rows
    : [];

  const summary = result?.data?.summary || {};

  if (!rows.length) {
    container.innerHTML = '<div class="teacher-recap-empty">📭 Tidak ada data siswa untuk pilihan tersebut.</div>';
    container.style.display = 'block';
    hideTeacherRecapDownload();
    return;
  }

  container.innerHTML = `
    <div class="teacher-recap-summary">
      <div><span>Total Siswa</span><strong>${summary.totalSiswa || rows.length}</strong></div>
      <div><span>🟢 Hadir</span><strong>${summary.hadir || 0}</strong></div>
      <div><span>🟡 Terlambat</span><strong>${summary.terlambat || 0}</strong></div>
      <div><span>🔵 Izin</span><strong>${summary.izin || 0}</strong></div>
      <div><span>🟣 Sakit</span><strong>${summary.sakit || 0}</strong></div>
      <div><span>🔴 Alpa</span><strong>${summary.alpa || 0}</strong></div>
      <div><span>🟠 Kegiatan</span><strong>${summary.kegiatan || 0}</strong></div>
    </div>

    <div class="teacher-recap-table-wrapper">
      <table class="teacher-recap-table">
        <thead>
          <tr>
            <th>No</th>
            <th>Siswa</th>
            <th>Hadir</th>
            <th>Terlambat</th>
            <th>Izin</th>
            <th>Sakit</th>
            <th>Alpa</th>
            <th>Kegiatan</th>
            <th>Total Hari</th>
            <th>% Kehadiran</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(function(item, index) {
            return `
              <tr>
                <td>${index + 1}</td>
                <td>
                  <strong>${escapeHTML(item.nama || '-')}</strong>
                  <div class="teacher-recap-student-id">${escapeHTML(item.studentId || '-')}</div>
                </td>
                <td>${item.hadir || 0}</td>
                <td>${item.terlambat || 0}</td>
                <td>${item.izin || 0}</td>
                <td>${item.sakit || 0}</td>
                <td>${item.alpa || 0}</td>
                <td>${item.kegiatan || 0}</td>
                <td>${item.totalHari || 0}</td>
                <td><strong>${Number(item.persentase || 0).toFixed(2)}%</strong></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  container.style.display = 'block';
}


function hideTeacherRecapDownload() {
  const wrap = $('teacherRecapDownloadWrap');
  const message = $('teacherRecapDownloadMessage');
  const button = $('teacherRecapDownloadButton');

  if (wrap) wrap.style.display = 'none';
  if (message) message.textContent = '';
  if (button) {
    button.disabled = false;
    button.textContent = '📥 Download Rekap Excel (.xlsx)';
  }
}


function showTeacherRecapDownload() {
  const wrap = $('teacherRecapDownloadWrap');
  if (wrap) wrap.style.display = 'flex';
}


function setTeacherRecapDownloadMessage(text, type = '') {
  const element = $('teacherRecapDownloadMessage');
  if (!element) return;

  element.textContent = text || '';
  element.className =
    'teacher-recap-download-message' +
    (type ? ' ' + type : '');
}


async function loadTeacherMonthlyRecap() {

  if (!currentToken) {
    setTeacherRecapMessage('⚠️ Sesi login tidak tersedia. Silakan login kembali.', 'error');
    return;
  }

  if (String(currentUser?.role || '').toUpperCase() !== 'GURU') {
    setTeacherRecapMessage('⛔ Rekap ini hanya tersedia untuk Guru.', 'error');
    return;
  }

  const monthElement = $('teacherRecapMonth');
  const yearElement = $('teacherRecapYear');
  const classElement = $('teacherRecapClass');
  const mapelElement = $('teacherRecapMapel');
  const button = $('teacherRebuildRecapButton');
  const resultContainer = $('teacherRecapResult');

  const bulan = monthElement?.value || String(new Date().getMonth() + 1);
  const tahun = yearElement?.value || String(new Date().getFullYear());
  const kelasId = classElement?.value || '';
  const mapelId = mapelElement?.value || '';

  if (!kelasId) {
    setTeacherRecapMessage('⚠️ Silakan pilih kelas.', 'error');
    return;
  }

  if (!mapelId) {
    setTeacherRecapMessage('⚠️ Silakan pilih mata pelajaran.', 'error');
    return;
  }

  const monthName = monthElement
    ? monthElement.options[monthElement.selectedIndex].text
    : bulan;
  const className = classElement
    ? classElement.options[classElement.selectedIndex].text
    : kelasId;
  const mapelName = mapelElement
    ? mapelElement.options[mapelElement.selectedIndex].text
    : mapelId;

  if (button) {
    button.disabled = true;
    button.textContent = '⏳ Memuat rekap...';
  }

  if (resultContainer) {
    resultContainer.style.display = 'none';
    resultContainer.innerHTML = '';
  }

  setTeacherRecapMessage(
    '⏳ Mengambil rekap ' + className + ' • ' + mapelName + ' • ' + monthName + ' ' + tahun + '...',
    'loading'
  );

  try {

    const result = await apiGet({
      action: 'teacherMonthlyRecap',
      token: currentToken,
      bulan: bulan,
      tahun: tahun,
      kelasId: kelasId,
      mapelId: mapelId
    });

    if (result?.status === 'SESSION_EXPIRED') {
      handleSessionExpired();
      return;
    }

    if (!result || !result.success) {
      throw new Error(result?.message || 'Rekap bulanan guru gagal dimuat.');
    }

    renderTeacherMonthlyRecap(result);
    showTeacherRecapDownload();
    setTeacherRecapDownloadMessage('Siap diunduh.', 'success');

    setTeacherRecapMessage(
      '✅ Rekap ' + className + ' • ' + mapelName + ' • ' + monthName + ' ' + tahun + ' selesai ditampilkan.',
      'success'
    );

  } catch (error) {

    console.error('TEACHER MONTHLY RECAP ERROR:', error);

    setTeacherRecapMessage(
      '❌ ' + (error.message || 'Rekap bulanan guru gagal dimuat.'),
      'error'
    );

  } finally {

    if (button) {
      button.disabled = false;
      button.textContent = '📊 Tampilkan Rekap';
    }
  }
}


async function downloadTeacherMonthlyRecapXlsx() {

  if (!currentToken) {
    setTeacherRecapDownloadMessage('⚠️ Sesi login tidak tersedia.', 'error');
    return;
  }

  const monthElement = $('teacherRecapMonth');
  const yearElement = $('teacherRecapYear');
  const classElement = $('teacherRecapClass');
  const mapelElement = $('teacherRecapMapel');
  const button = $('teacherRecapDownloadButton');

  const bulan = monthElement?.value || String(new Date().getMonth() + 1);
  const tahun = yearElement?.value || String(new Date().getFullYear());
  const kelasId = classElement?.value || '';
  const mapelId = mapelElement?.value || '';

  if (!kelasId || !mapelId) {
    setTeacherRecapDownloadMessage('⚠️ Pilih kelas dan mata pelajaran terlebih dahulu.', 'error');
    return;
  }

  const className = classElement
    ? classElement.options[classElement.selectedIndex].text
    : kelasId;
  const mapelName = mapelElement
    ? mapelElement.options[mapelElement.selectedIndex].text
    : mapelId;
  const monthName = monthElement
    ? monthElement.options[monthElement.selectedIndex].text
    : bulan;

  if (button) {
    button.disabled = true;
    button.textContent = '⏳ Menyiapkan Excel...';
  }

  setTeacherRecapDownloadMessage(
    '⏳ Menyiapkan file Excel ' + className + ' • ' + mapelName + '...',
    'loading'
  );

  try {

    const result = await apiGet(
      {
        action: 'exportTeacherMonthlyRecapXlsx',
        token: currentToken,
        bulan: bulan,
        tahun: tahun,
        kelasId: kelasId,
        mapelId: mapelId
      },
      { timeoutMs: 330000 }
    );

    if (result?.status === 'SESSION_EXPIRED') {
      handleSessionExpired();
      return;
    }

    if (!result || !result.success || !result.dataBase64) {
      throw new Error(result?.message || 'File Excel gagal dibuat.');
    }

    downloadBase64File(
      result.dataBase64,
      result.fileName || ('Rekap_' + className + '_' + mapelName + '_' + monthName + '_' + tahun + '.xlsx'),
      result.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    setTeacherRecapDownloadMessage('✅ File Excel berhasil dibuat dan diunduh.', 'success');

  } catch (error) {

    console.error('DOWNLOAD TEACHER RECAP ERROR:', error);
    setTeacherRecapDownloadMessage(
      '❌ ' + (error.message || 'Gagal membuat file Excel.'),
      'error'
    );

  } finally {

    if (button) {
      button.disabled = false;
      button.textContent = '📥 Download Rekap Excel (.xlsx)';
    }
  }
}


/* ============================================================
   42. REKAP BULANAN ADMIN
============================================================ */

function injectAdminRecapPanel() {

  const dashboard = $('dashboard');
  if (!dashboard) return;

  if ($('adminMonthlyRecapPanel')) return;

  const panel = document.createElement('section');
  panel.id = 'adminMonthlyRecapPanel';
  panel.className = 'admin-monthly-recap-panel';

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const months = [
    'Januari','Februari','Maret','April','Mei','Juni',
    'Juli','Agustus','September','Oktober','November','Desember'
  ];

  panel.innerHTML = `
    <div class="admin-recap-header">
      <div>
        <div class="admin-recap-title">📊 Rekap Bulanan</div>
        <div class="admin-recap-subtitle">
          Rekap hanya diperbarui ketika Admin menekan tombol.
          Proses ini tidak dijalankan saat siswa scan.
        </div>
      </div>
    </div>

    <div class="admin-recap-controls">
      <label class="admin-recap-field">
        <span>Bulan</span>
        <select id="adminRecapMonth">
          ${months.map((name, i) => `
            <option value="${i + 1}" ${i + 1 === currentMonth ? 'selected' : ''}>
              ${name}
            </option>
          `).join('')}
        </select>
      </label>

      <label class="admin-recap-field">
        <span>Tahun</span>
        <select id="adminRecapYear">
          ${Array.from({length: 5}, (_, i) => currentYear - 2 + i).map(year => `
            <option value="${year}" ${year === currentYear ? 'selected' : ''}>
              ${year}
            </option>
          `).join('')}
        </select>
      </label>

      <button
        type="button"
        id="adminRebuildRecapButton"
        class="admin-recap-button"
      >
        🔄 Perbarui Rekap
      </button>
    </div>

    <div class="admin-recap-progress-wrap" id="adminRecapProgressWrap" style="display:none;">
      <div class="admin-recap-progress-top">
        <span id="adminRecapProgressText">Menyiapkan proses rekap...</span>
        <strong id="adminRecapProgressPercent">0%</strong>
      </div>
      <div class="admin-recap-progress-track" aria-hidden="true">
        <div id="adminRecapProgressBar" class="admin-recap-progress-bar" style="width:0%;"></div>
      </div>
    </div>

    <div id="adminRecapMessage" class="admin-recap-message" aria-live="polite"></div>

    <div id="adminRecapDownloadWrap" class="admin-recap-download-wrap" style="display:none;">
      <button
        type="button"
        id="adminRecapDownloadButton"
        class="admin-recap-download-button"
      >
        📥 Download Hasil Rekap (.xlsx)
      </button>
      <span id="adminRecapDownloadMessage" class="admin-recap-download-message"></span>
    </div>
  `;

  const userElement = $('dashboardUser');

  if (userElement && userElement.parentNode) {
    userElement.parentNode.insertBefore(
      panel,
      userElement.nextSibling
    );
  } else {
    dashboard.insertBefore(panel, dashboard.firstChild);
  }

  const button = $('adminRebuildRecapButton');

  if (button) {
    button.addEventListener('click', rebuildMonthlyRecapFromDashboard);
  }

  const downloadButton = $('adminRecapDownloadButton');
  if (downloadButton) {
    downloadButton.addEventListener('click', downloadAdminMonthlyRecapXlsx);
  }

  const monthSelect = $('adminRecapMonth');
  if (monthSelect) monthSelect.addEventListener('change', hideAdminRecapDownload);

  const yearSelect = $('adminRecapYear');
  if (yearSelect) yearSelect.addEventListener('change', hideAdminRecapDownload);
}


function setAdminRecapVisibility(visible) {

  const panel = $('adminMonthlyRecapPanel');

  if (!panel) return;

  panel.style.display = visible ? 'block' : 'none';
}


function setAdminRecapMessage(text, type = '') {

  const element = $('adminRecapMessage');
  if (!element) return;

  element.textContent = text || '';
  element.className =
    'admin-recap-message' +
    (type ? ' ' + type : '');
}


function setAdminRecapProgress(percent, text) {

  const safePercent = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  const wrap = $('adminRecapProgressWrap');
  const bar = $('adminRecapProgressBar');
  const percentText = $('adminRecapProgressPercent');
  const progressText = $('adminRecapProgressText');

  if (wrap) {
    wrap.style.display = 'block';
  }

  if (bar) {
    bar.style.width = safePercent + '%';
  }

  if (percentText) {
    percentText.textContent = safePercent + '%';
  }

  if (progressText && text) {
    progressText.textContent = text;
  }
}


function hideAdminRecapProgress() {

  const wrap = $('adminRecapProgressWrap');

  if (wrap) {
    wrap.style.display = 'none';
  }
}


function startAdminRecapProgressSimulation(monthName, tahun) {

  clearInterval(window.__adminRecapProgressTimer);

  let percent = 0;

  setAdminRecapProgress(
    0,
    '⏳ Menyiapkan rekap ' + monthName + ' ' + tahun + '...'
  );

  window.__adminRecapProgressTimer = setInterval(function () {

    if (percent < 70) {
      percent += 5;
    } else if (percent < 90) {
      percent += 2;
    } else if (percent < 95) {
      percent += 1;
    }

    let text = '⏳ Membaca data ABSENSI dan menyusun rekap...';

    if (percent >= 70 && percent < 90) {
      text = '🔄 Mengolah data siswa dan status kehadiran...';
    } else if (percent >= 90) {
      text = '💾 Menulis REKAP_BULANAN. Mohon tunggu...';
    }

    setAdminRecapProgress(percent, text);

  }, 900);
}


function stopAdminRecapProgressSimulation() {

  clearInterval(window.__adminRecapProgressTimer);
  window.__adminRecapProgressTimer = null;
}


function hideAdminRecapDownload() {
  const wrap = $('adminRecapDownloadWrap');
  const message = $('adminRecapDownloadMessage');
  const button = $('adminRecapDownloadButton');

  if (wrap) wrap.style.display = 'none';
  if (message) message.textContent = '';
  if (button) {
    button.disabled = false;
    button.textContent = '📥 Download Hasil Rekap (.xlsx)';
  }
}


function showAdminRecapDownload() {
  const wrap = $('adminRecapDownloadWrap');
  if (wrap) wrap.style.display = 'flex';
}


function setAdminRecapDownloadMessage(text, type = '') {
  const element = $('adminRecapDownloadMessage');
  if (!element) return;

  element.textContent = text || '';
  element.className =
    'admin-recap-download-message' +
    (type ? ' ' + type : '');
}


function downloadBase64File(base64, fileName, mimeType) {
  const binary = atob(base64);
  const length = binary.length;
  const bytes = new Uint8Array(length);

  for (let i = 0; i < length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const blob = new Blob([bytes], {
    type: mimeType || 'application/octet-stream'
  });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName || 'rekap.xlsx';
  anchor.style.display = 'none';

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(function() {
    URL.revokeObjectURL(url);
  }, 30000);
}


async function downloadAdminMonthlyRecapXlsx() {

  if (!currentToken) {
    setAdminRecapDownloadMessage('⚠️ Sesi login tidak tersedia.', 'error');
    return;
  }

  const monthElement = $('adminRecapMonth');
  const yearElement = $('adminRecapYear');
  const button = $('adminRecapDownloadButton');

  const bulan = monthElement?.value || String(new Date().getMonth() + 1);
  const tahun = yearElement?.value || String(new Date().getFullYear());

  const monthName = monthElement
    ? monthElement.options[monthElement.selectedIndex].text
    : bulan;

  if (button) {
    button.disabled = true;
    button.textContent = '⏳ Menyiapkan Excel...';
  }

  setAdminRecapDownloadMessage(
    '⏳ Menyiapkan file Excel Rekap ' + monthName + ' ' + tahun + '...',
    'loading'
  );

  try {

    const result = await apiGet(
      {
        action: 'exportMonthlyRecapXlsx',
        token: currentToken,
        bulan: bulan,
        tahun: tahun
      },
      { timeoutMs: 330000 }
    );

    if (result?.status === 'SESSION_EXPIRED') {
      handleSessionExpired();
      return;
    }

    if (!result || !result.success || !result.dataBase64) {
      throw new Error(result?.message || 'File Excel gagal dibuat.');
    }

    downloadBase64File(
      result.dataBase64,
      result.fileName || ('Rekap_Bulanan_Semua_Siswa_' + monthName + '_' + tahun + '.xlsx'),
      result.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    setAdminRecapDownloadMessage('✅ File Excel berhasil dibuat dan diunduh.', 'success');

  } catch (error) {

    console.error('DOWNLOAD ADMIN RECAP ERROR:', error);
    setAdminRecapDownloadMessage(
      '❌ ' + (error.message || 'Gagal membuat file Excel.'),
      'error'
    );

  } finally {

    if (button) {
      button.disabled = false;
      button.textContent = '📥 Download Hasil Rekap (.xlsx)';
    }
  }
}


async function rebuildMonthlyRecapFromDashboard() {

  if (!currentToken) {
    setAdminRecapMessage(
      '⚠️ Sesi login tidak tersedia. Silakan login kembali.',
      'error'
    );
    return;
  }

  const role = String(currentUser?.role || '').toUpperCase();

  if (role !== 'ADMIN') {
    setAdminRecapMessage(
      '⛔ Hanya Admin yang dapat memperbarui rekap bulanan.',
      'error'
    );
    return;
  }

  const monthElement = $('adminRecapMonth');
  const yearElement = $('adminRecapYear');
  const button = $('adminRebuildRecapButton');

  const bulan = monthElement
    ? monthElement.value
    : String(new Date().getMonth() + 1);

  const tahun = yearElement
    ? yearElement.value
    : String(new Date().getFullYear());

  const monthName = monthElement
    ? monthElement.options[monthElement.selectedIndex].text
    : bulan;

  const confirmed = window.confirm(
    'Perbarui REKAP_BULANAN untuk ' +
    monthName + ' ' + tahun + '?\n\n' +
    'Proses ini membaca ABSENSI dan menulis ulang rekap bulan tersebut.\n' +
    'Scanner siswa tetap aman karena proses ini hanya dijalankan setelah Anda menekan OK.'
  );

  if (!confirmed) {
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = '⏳ Sedang merekap...';
  }

  setAdminRecapMessage(
    '⏳ Proses rekap sedang berjalan. Jangan menutup halaman sampai proses selesai.',
    'loading'
  );

  startAdminRecapProgressSimulation(monthName, tahun);

  try {

    /*
     * Rekap memang dapat membutuhkan waktu lebih lama karena server
     * membaca ABSENSI lalu menulis ulang REKAP_BULANAN.
     * Timeout khusus rekap dibuat jauh lebih panjang daripada scanner.
     * Ini TIDAK mengubah timeout scanner yang tetap 20 detik.
     */
    const result = await apiGet(
      {
        action: 'rebuildMonthlyRecap',
        token: currentToken,
        bulan: bulan,
        tahun: tahun
      },
      {
        timeoutMs: 330000
      }
    );

    if (result?.status === 'SESSION_EXPIRED') {
      stopAdminRecapProgressSimulation();
      hideAdminRecapProgress();
      handleSessionExpired();
      return;
    }

    if (!result || !result.success) {
      throw new Error(
        result?.message ||
        'Rekap bulanan gagal diperbarui.'
      );
    }

    stopAdminRecapProgressSimulation();
    setAdminRecapProgress(
      100,
      '✅ Proses rekap selesai.'
    );

    const data = result.data || {};
    const totalSiswa =
      data.totalSiswa ??
      data.total ??
      0;

    setAdminRecapMessage(
      '✅ Proses rekap selesai. REKAP_BULANAN ' +
      monthName + ' ' + tahun +
      ' berhasil diperbarui. ' +
      totalSiswa + ' siswa diproses.',
      'success'
    );

    showAdminRecapDownload();
    setAdminRecapDownloadMessage('Siap diunduh.', 'success');

  } catch (error) {

    stopAdminRecapProgressSimulation();

    console.error(
      'REBUILD MONTHLY RECAP ERROR:',
      error
    );

    /*
     * Tidak lagi menampilkan kalimat "Server terlalu lama..."
     * khusus proses rekap. Admin mendapat pesan yang lebih jelas.
     */
    const rawMessage = String(error?.message || '');
    const isTimeout =
      error?.name === 'AbortError' ||
      rawMessage.toLowerCase().includes('terlalu lama') ||
      rawMessage.toLowerCase().includes('timeout');

    setAdminRecapProgress(
      0,
      isTimeout
        ? '⚠️ Proses belum dapat dikonfirmasi selesai.'
        : '⚠️ Proses rekap berhenti sebelum selesai.'
    );

    setAdminRecapMessage(
      isTimeout
        ? '⚠️ Proses rekap belum dapat dikonfirmasi selesai. Silakan periksa REKAP_BULANAN sebelum menjalankan rekap lagi.'
        : '❌ Proses rekap belum selesai. ' +
          (rawMessage || 'Terjadi kesalahan saat memperbarui rekap.'),
      'error'
    );

  } finally {

    if (button) {
      button.disabled = false;
      button.textContent = '🔄 Perbarui Rekap';
    }
  }
}


/* ============================================================
   43. WHATSAPP CENTER ADMIN V19
   ------------------------------------------------------------
   UI langsung di Dashboard Admin.
   Komunikasi tetap menggunakan fetch(API_URL) -> doGet().
============================================================ */

let waCenterHistoryData = [];
let waCenterRecipientsData = [];
let waCenterHistoryLoading = false;
let waCenterDashboardLoading = false;
let waCenterStandaloneVisible = false;


function injectAdminWhatsAppPanel() {

  if ($('adminWhatsAppCenter')) return;

  const page = document.createElement('section');
  page.id = 'adminWhatsAppCenter';
  page.className = 'wa-center-page';
  page.style.display = 'none';

  page.innerHTML = `
    <div class="wa-page-shell">
      <div class="wa-page-topbar">
        <div>
          <div class="wa-page-kicker">ADMINISTRATOR</div>
          <div class="wa-page-title">💬 WhatsApp Center</div>
          <div class="wa-page-subtitle">Pusat kendali notifikasi WhatsApp orang tua/wali siswa.</div>
        </div>
        <div class="wa-page-top-actions">
          <span id="waConnectionBadge" class="wa-connection-badge">⏳ Memeriksa koneksi...</span>
          <button type="button" id="waCenterRefreshButton" class="wa-secondary-button">🔄 Refresh</button>
          <button type="button" id="waCenterBackButton" class="wa-back-button">← Kembali</button>
        </div>
      </div>

      <div class="wa-date-row">
        <label class="wa-field wa-date-field">
          <span>Tanggal Statistik</span>
          <input type="date" id="waDashboardDate">
        </label>
        <div id="waDashboardMessage" class="wa-inline-message" aria-live="polite"></div>
      </div>

      <div class="wa-stat-grid">
        <div class="wa-stat-card wa-stat-total"><span>📨 Total</span><strong id="waStatTotal">0</strong><small>Log WhatsApp</small></div>
        <div class="wa-stat-card wa-stat-sent"><span>✅ Terkirim</span><strong id="waStatSent">0</strong><small>Berhasil dikirim</small></div>
        <div class="wa-stat-card wa-stat-failed"><span>❌ Gagal</span><strong id="waStatFailed">0</strong><small>Perlu diperiksa</small></div>
        <div class="wa-stat-card wa-stat-pending"><span>⏳ Pending</span><strong id="waStatPending">0</strong><small>Menunggu proses</small></div>
        <div class="wa-stat-card wa-stat-auto"><span>⚙️ Otomatis</span><strong id="waStatAuto">0</strong><small>Notifikasi sistem</small></div>
        <div class="wa-stat-card wa-stat-manual"><span>💬 Manual</span><strong id="waStatManual">0</strong><small>Dikirim Admin</small></div>
      </div>

      <div class="wa-center-grid">
        <section class="wa-box wa-manual-box">
          <div class="wa-box-title">💬 Kirim Pesan WA Manual</div>
          <div class="wa-box-subtitle">Pesan dikirim ke nomor WhatsApp orang tua/wali siswa.</div>

          <label class="wa-field"><span>Cari Siswa</span><input type="search" id="waRecipientSearch" placeholder="Ketik nama, Student ID, atau kelas..." autocomplete="off"></label>
          <label class="wa-field"><span>Pilih Siswa</span><select id="waRecipientSelect"><option value="">⏳ Memuat daftar siswa...</option></select></label>
          <div id="waRecipientInfo" class="wa-recipient-info">Pilih siswa untuk melihat informasi penerima.</div>
          <label class="wa-field"><span>Isi Pesan</span><textarea id="waManualMessage" rows="7" maxlength="4000" placeholder="Tulis pesan untuk orang tua/wali siswa..."></textarea><div class="wa-char-counter"><span id="waMessageCharCount">0</span>/4000 karakter</div></label>
          <div id="waManualMessageBox" class="wa-message-box" aria-live="polite"></div>
          <button type="button" id="waManualSendButton" class="wa-primary-button">💬 Kirim Pesan WhatsApp</button>
        </section>

        <section class="wa-box wa-settings-box">
          <div class="wa-box-title">⚙️ Pengaturan WhatsApp</div>
          <div class="wa-box-subtitle">Atur kapan sistem mengirim notifikasi otomatis.</div>
          <div class="wa-setting-main"><label class="wa-switch-row"><input type="checkbox" id="waSettingEnabled"><span class="wa-switch-ui"></span><span><strong>Aktifkan WhatsApp</strong><small>Master switch notifikasi WhatsApp</small></span></label></div>
          <div class="wa-setting-list">
            <label class="wa-switch-row compact"><input type="checkbox" id="waSettingFirstDailyOnly"><span class="wa-switch-ui"></span><span><strong>Hanya 1 WA per siswa per hari</strong><small>Mencegah notifikasi otomatis berulang</small></span></label>
            <label class="wa-switch-row compact"><input type="checkbox" id="waSettingManualStatus"><span class="wa-switch-ui"></span><span><strong>WA saat status manual berubah</strong><small>Guru/Admin mengubah status absensi</small></span></label>
          </div>
          <div class="wa-rule-title">Notifikasi berdasarkan status</div>
          <div class="wa-rule-grid">
            <label class="wa-rule-item"><input type="checkbox" id="waRuleHadir"><span>Hadir</span></label>
            <label class="wa-rule-item"><input type="checkbox" id="waRuleTerlambat"><span>Terlambat</span></label>
            <label class="wa-rule-item"><input type="checkbox" id="waRuleIzin"><span>Izin</span></label>
            <label class="wa-rule-item"><input type="checkbox" id="waRuleSakit"><span>Sakit</span></label>
            <label class="wa-rule-item"><input type="checkbox" id="waRuleAlpa"><span>Alpa</span></label>
            <label class="wa-rule-item"><input type="checkbox" id="waRuleKegiatan"><span>Kegiatan</span></label>
            <label class="wa-rule-item"><input type="checkbox" id="waRuleIzinPulang"><span>Izin Pulang</span></label>
          </div>
          <div id="waSettingsMessage" class="wa-message-box" aria-live="polite"></div>
          <button type="button" id="waSaveSettingsButton" class="wa-primary-button">💾 Simpan Pengaturan WA</button>
        </section>
      </div>

      <section class="wa-box wa-history-box">
        <div class="wa-history-header"><div><div class="wa-box-title">📋 Riwayat WhatsApp</div><div class="wa-box-subtitle">Data bersumber dari sheet LOG_WA.</div></div><span id="waHistoryCount" class="wa-history-count">0 data</span></div>
        <div class="wa-history-filters">
          <label class="wa-field"><span>Status Kirim</span><select id="waHistoryStatus"><option value="">Semua Status</option><option value="TERKIRIM">Terkirim</option><option value="GAGAL">Gagal</option><option value="PENDING">Pending</option></select></label>
          <button type="button" id="waHistoryLoadButton" class="wa-secondary-button">🔍 Tampilkan</button>
        </div>
        <div id="waHistoryMessage" class="wa-inline-message" aria-live="polite"></div>
        <div id="waHistoryTableWrap" class="wa-history-table-wrap"><div class="app-loading">Memuat riwayat WhatsApp...</div></div>
      </section>
    </div>

    <footer class="wa-page-footer">
      <div class="wa-page-footer-name">ABSENSI KARTU PELAJAR</div>
      <div class="wa-page-footer-meta">
        WhatsApp Center &nbsp;•&nbsp; Versi 20.1 &nbsp;•&nbsp; SMP &amp; SMA Baitul Ulum Boarding School &nbsp;•&nbsp; © 2026
      </div>
    </footer>
  `;

  document.body.appendChild(page);

  const now = new Date();
  const dateInput = $('waDashboardDate');
  if (dateInput) dateInput.value = formatLocalDateForInput(now);

  bindAdminWhatsAppEvents();
}


function injectAdminWhatsAppButton() {

  const dashboard = $('dashboard');
  if (!dashboard || $('adminWhatsAppLauncher')) return;

  const launcher = document.createElement('section');
  launcher.id = 'adminWhatsAppLauncher';
  launcher.className = 'wa-launcher';
  launcher.innerHTML = `
    <div class="dashboard-section">

      <div class="wa-launcher-title">💬 WhatsApp Center</div>
      <div class="wa-launcher-subtitle">Kelola notifikasi WhatsApp orang tua/wali siswa tanpa memenuhi Dashboard Administrator.</div>
    </div>
    <button type="button" id="openAdminWhatsAppButton" class="wa-open-button">WhatsApp Center →</button>
  
  `;

  const adminRecap = $('adminMonthlyRecapPanel');
  if (adminRecap && adminRecap.parentNode) {
    adminRecap.parentNode.insertBefore(launcher, adminRecap);
  } else {
    dashboard.insertBefore(launcher, dashboard.firstChild);
  }

  const button = $('openAdminWhatsAppButton');
  if (button) button.addEventListener('click', openAdminWhatsAppCenter);
}


function setAdminWhatsAppButtonVisibility(visible) {
  const launcher = $('adminWhatsAppLauncher');
  if (launcher) launcher.style.display = visible ? 'flex' : 'none';
}


function openAdminWhatsAppCenter() {

  if (!currentToken || String(currentUser?.role || '').toUpperCase() !== 'ADMIN') {
    openLoginModal();
    return;
  }

  injectAdminWhatsAppPanel();
  waCenterStandaloneVisible = true;

  const dashboard = $('dashboard');
  if (dashboard) dashboard.style.display = 'none';

  const globalFooter = $('appFooter');
  if (globalFooter) globalFooter.style.display = 'none';

  setPublicScannerAreaVisibility(false);
  setAdminWhatsAppVisibility(true);

  window.scrollTo({ top: 0, behavior: 'smooth' });
}


function closeAdminWhatsAppCenter() {

  waCenterStandaloneVisible = false;
  setAdminWhatsAppVisibility(false);

  const page = $('adminWhatsAppCenter');
  if (page) page.scrollTop = 0;
}


function formatLocalDateForInput(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0')
  ].join('-');
}


function setAdminWhatsAppVisibility(visible) {
  const panel = $('adminWhatsAppCenter');
  if (!panel) return;
  panel.style.display = visible ? 'block' : 'none';

  if (visible && currentToken && String(currentUser?.role || '').toUpperCase() === 'ADMIN') {
    loadWACenterDashboard(true);
  }
}


function closeAdminWhatsAppCenterAndReturn() {
  closeAdminWhatsAppCenter();

  if (currentToken && String(currentUser?.role || '').toUpperCase() === 'ADMIN') {
    const dashboard = $('dashboard');
    if (dashboard) dashboard.style.display = 'block';

    const globalFooter = $('appFooter');
    if (globalFooter) globalFooter.style.display = '';

    setPublicScannerAreaVisibility(false);
    setAdminWhatsAppButtonVisibility(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}


function bindAdminWhatsAppEvents() {

  const refreshButton = $('waCenterRefreshButton');
  if (refreshButton) {
    refreshButton.addEventListener('click', function() {
      loadWACenterDashboard(true);
    });
  }

  const backButton = $('waCenterBackButton');
  if (backButton) {
    backButton.addEventListener('click', closeAdminWhatsAppCenterAndReturn);
  }

  const dateInput = $('waDashboardDate');
  if (dateInput) {
    dateInput.addEventListener('change', function() {
      loadWACenterDashboard(true);
    });
  }

  const recipientSearch = $('waRecipientSearch');
  if (recipientSearch) {
    recipientSearch.addEventListener('input', debounceWA(function() {
      renderWARecipients(recipientSearch.value);
    }, 180));
  }

  const recipientSelect = $('waRecipientSelect');
  if (recipientSelect) {
    recipientSelect.addEventListener('change', updateWARecipientInfo);
  }

  const message = $('waManualMessage');
  if (message) {
    message.addEventListener('input', updateWAMessageCounter);
  }

  const sendButton = $('waManualSendButton');
  if (sendButton) sendButton.addEventListener('click', sendManualWAMessageFromDashboard);

  const saveButton = $('waSaveSettingsButton');
  if (saveButton) saveButton.addEventListener('click', saveWACenterSettings);

  const historyButton = $('waHistoryLoadButton');
  if (historyButton) historyButton.addEventListener('click', loadWAHistory);

  ['waHistoryStatus', 'waHistoryType'].forEach(function(id) {
    const el = $(id);
    if (el) el.addEventListener('change', loadWAHistory);
  });

  const historySearch = $('waHistorySearch');
  if (historySearch) {
    historySearch.addEventListener('keydown', function(event) {
      if (event.key === 'Enter') loadWAHistory();
    });
  }
}


function debounceWA(fn, delay) {
  let timer = null;
  return function() {
    const args = arguments;
    const context = this;
    clearTimeout(timer);
    timer = setTimeout(function() {
      fn.apply(context, args);
    }, delay);
  };
}


async function loadWACenterDashboard(showLoading = true) {

  if (waCenterDashboardLoading) return;
  if (!currentToken || String(currentUser?.role || '').toUpperCase() !== 'ADMIN') return;
  if (!$('adminWhatsAppCenter')) return;

  waCenterDashboardLoading = true;
  const button = $('waCenterRefreshButton');
  if (button && showLoading) {
    button.disabled = true;
    button.textContent = '⏳ Memuat...';
  }

  try {
    const dateInput = $('waDashboardDate');
    const tanggal = dateInput?.value || formatLocalDateForInput(new Date());

    const result = await apiGet({
      action: 'waDashboard',
      token: currentToken,
      tanggal: tanggal
    });

    if (result?.status === 'SESSION_EXPIRED') {
      handleSessionExpired();
      return;
    }

    if (!result || !result.success) {
      throw new Error(result?.message || 'Data WhatsApp Center tidak dapat dimuat.');
    }

    renderWAConnection(result.tokenConfigured, result.settings);
    renderWAStats(result.stats || {});
    renderWASettings(result.settings || {});

    await Promise.all([
      loadWARecipients(),
      loadWAHistory()
    ]);

    setWAMessage('waDashboardMessage', 'WhatsApp Center berhasil diperbarui.', 'success');

  } catch (error) {
    console.error('WA CENTER LOAD ERROR:', error);
    setWAMessage('waDashboardMessage', error.message || 'Gagal memuat WhatsApp Center.', 'error');
  } finally {
    waCenterDashboardLoading = false;
    if (button) {
      button.disabled = false;
      button.textContent = '🔄 Refresh';
    }
  }
}


function renderWAConnection(tokenConfigured, settings) {
  const badge = $('waConnectionBadge');
  if (!badge) return;

  const enabled = !!settings?.enabled;

  if (!tokenConfigured) {
    badge.textContent = '🔴 Token Fonnte belum ada';
    badge.className = 'wa-connection-badge danger';
    return;
  }

  if (!enabled) {
    badge.textContent = '🟡 WA terhubung • NONAKTIF';
    badge.className = 'wa-connection-badge warning';
    return;
  }

  badge.textContent = '🟢 WA terhubung • AKTIF';
  badge.className = 'wa-connection-badge success';
}


function renderWAStats(stats) {
  setText('waStatTotal', Number(stats.total || 0));
  setText('waStatSent', Number(stats.terkirim || 0));
  setText('waStatFailed', Number(stats.gagal || 0));
  setText('waStatPending', Number(stats.pending || 0));
  setText('waStatAuto', Number(stats.otomatis || 0));
  setText('waStatManual', Number(stats.manual || 0));
}


function renderWASettings(settings) {
  const data = settings || {};
  const status = data.status || {};

  setChecked('waSettingEnabled', data.enabled);
  setChecked('waSettingFirstDailyOnly', data.firstDailyOnly);
  setChecked('waSettingManualStatus', data.manualStatus);

  setChecked('waRuleHadir', status.HADIR);
  setChecked('waRuleTerlambat', status.TERLAMBAT);
  setChecked('waRuleIzin', status.IZIN);
  setChecked('waRuleSakit', status.SAKIT);
  setChecked('waRuleAlpa', status.ALPA);
  setChecked('waRuleKegiatan', status.KEGIATAN);
  setChecked('waRuleIzinPulang', status['IZIN PULANG']);
}


function setChecked(id, value) {
  const el = $(id);
  if (el) el.checked = !!value;
}


async function loadWARecipients() {

  if (!currentToken || String(currentUser?.role || '').toUpperCase() !== 'ADMIN') return;

  try {
    const result = await apiGet({
      action: 'waRecipients',
      token: currentToken
    });

    if (result?.status === 'SESSION_EXPIRED') {
      handleSessionExpired();
      return;
    }

    if (!result || !result.success) {
      throw new Error(result?.message || 'Daftar penerima tidak dapat dimuat.');
    }

    waCenterRecipientsData = Array.isArray(result.data) ? result.data : [];
    renderWARecipients($('waRecipientSearch')?.value || '');

  } catch (error) {
    console.error('WA RECIPIENT ERROR:', error);
    const select = $('waRecipientSelect');
    if (select) select.innerHTML = '<option value="">❌ Gagal memuat daftar siswa</option>';
    setWAMessage('waManualMessageBox', error.message || 'Gagal memuat penerima.', 'error');
  }
}


function renderWARecipients(searchText) {
  const select = $('waRecipientSelect');
  if (!select) return;

  const q = String(searchText || '').trim().toLowerCase();
  const list = waCenterRecipientsData.filter(function(item) {
    if (!q) return true;
    return [item.studentId, item.nama, item.kelas].some(function(value) {
      return String(value || '').toLowerCase().includes(q);
    });
  });

  select.innerHTML = '<option value="">-- Pilih siswa --</option>' + list.map(function(item) {
    const ortu = item.namaOrtu ? ' • ' + item.namaOrtu : '';
    return '<option value="' + escapeHTML(item.studentId) + '">' +
      escapeHTML(item.nama) + ' • ' + escapeHTML(item.kelas || '-') +
      ' • WA: ' + escapeHTML(item.noWaOrtu || '-') + ortu + '</option>';
  }).join('');

  if (!list.length) {
    select.innerHTML = '<option value="">Tidak ada siswa yang cocok</option>';
  }

  updateWARecipientInfo();
}


function updateWARecipientInfo() {
  const select = $('waRecipientSelect');
  const info = $('waRecipientInfo');
  if (!select || !info) return;

  const id = select.value;
  const item = waCenterRecipientsData.find(function(x) {
    return String(x.studentId) === String(id);
  });

  if (!item) {
    info.innerHTML = 'Pilih siswa untuk melihat informasi penerima.';
    return;
  }

  info.innerHTML =
    '<strong>' + escapeHTML(item.nama) + '</strong>' +
    '<span>' + escapeHTML(item.kelas || '-') + '</span>' +
    '<span>👤 ' + escapeHTML(item.namaOrtu || 'Orang Tua/Wali') + '</span>' +
    '<span>📱 ' + escapeHTML(item.noWaOrtu || '-') + '</span>';
}


function updateWAMessageCounter() {
  const input = $('waManualMessage');
  const counter = $('waMessageCharCount');
  if (counter) counter.textContent = String(input?.value?.length || 0);
}


function getWASettingsFromUI() {
  return {
    enabled: !!$('waSettingEnabled')?.checked,
    firstDailyOnly: !!$('waSettingFirstDailyOnly')?.checked,
    manualStatus: !!$('waSettingManualStatus')?.checked,
    status: {
      HADIR: !!$('waRuleHadir')?.checked,
      TERLAMBAT: !!$('waRuleTerlambat')?.checked,
      IZIN: !!$('waRuleIzin')?.checked,
      SAKIT: !!$('waRuleSakit')?.checked,
      ALPA: !!$('waRuleAlpa')?.checked,
      KEGIATAN: !!$('waRuleKegiatan')?.checked,
      'IZIN PULANG': !!$('waRuleIzinPulang')?.checked
    }
  };
}


async function saveWACenterSettings() {

  if (!currentToken) return;

  const button = $('waSaveSettingsButton');
  const settings = getWASettingsFromUI();

  if (button) {
    button.disabled = true;
    button.textContent = '⏳ Menyimpan...';
  }

  try {
    const result = await apiGet({
      action: 'saveWASettings',
      token: currentToken,
      settings: JSON.stringify(settings)
    }, { timeoutMs: 20000 });

    if (result?.status === 'SESSION_EXPIRED') {
      handleSessionExpired();
      return;
    }

    if (!result || !result.success) {
      throw new Error(result?.message || 'Pengaturan WA gagal disimpan.');
    }

    renderWASettings(result.data || settings);
    renderWAConnection(true, result.data || settings);
    setWAMessage('waSettingsMessage', '✅ Pengaturan WhatsApp berhasil disimpan.', 'success');

  } catch (error) {
    console.error('WA SETTINGS ERROR:', error);
    setWAMessage('waSettingsMessage', error.message || 'Gagal menyimpan pengaturan.', 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = '💾 Simpan Pengaturan WA';
    }
  }
}


async function sendManualWAMessageFromDashboard() {

  if (!currentToken) return;

  const studentId = $('waRecipientSelect')?.value || '';
  const messageInput = $('waManualMessage');
  const message = String(messageInput?.value || '').trim();
  const button = $('waManualSendButton');

  if (!studentId) {
    setWAMessage('waManualMessageBox', '⚠️ Pilih siswa terlebih dahulu.', 'error');
    return;
  }

  if (!message) {
    setWAMessage('waManualMessageBox', '⚠️ Isi pesan belum diisi.', 'error');
    messageInput?.focus();
    return;
  }

  if (message.length > 4000) {
    setWAMessage('waManualMessageBox', '⚠️ Pesan maksimal 4000 karakter.', 'error');
    return;
  }

  if (!confirm('Kirim pesan WhatsApp ke orang tua/wali siswa ini?')) return;

  if (button) {
    button.disabled = true;
    button.textContent = '⏳ Mengirim WhatsApp...';
  }

  try {
    const result = await apiGet({
      action: 'sendManualWA',
      token: currentToken,
      studentId: studentId,
      message: message
    }, { timeoutMs: 30000 });

    if (result?.status === 'SESSION_EXPIRED') {
      handleSessionExpired();
      return;
    }

    if (!result || !result.success) {
      throw new Error(result?.message || 'Pesan WhatsApp gagal dikirim.');
    }

    setWAMessage(
      'waManualMessageBox',
      '✅ Pesan berhasil dikirim ke orang tua/wali ' + (result.data?.nama || 'siswa') + '.',
      'success'
    );

    if (messageInput) messageInput.value = '';
    updateWAMessageCounter();

    await loadWACenterDashboard(true);

  } catch (error) {
    console.error('WA MANUAL ERROR:', error);
    setWAMessage('waManualMessageBox', error.message || 'Pengiriman WhatsApp gagal.', 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = '💬 Kirim Pesan WhatsApp';
    }
  }
}


async function loadWAHistory() {

  if (waCenterHistoryLoading) return;
  if (!currentToken || String(currentUser?.role || '').toUpperCase() !== 'ADMIN') return;
  if (!$('waHistoryTableWrap')) return;

  waCenterHistoryLoading = true;

  const wrap = $('waHistoryTableWrap');
  const button = $('waHistoryLoadButton');
  if (button) {
    button.disabled = true;
    button.textContent = '⏳ Memuat...';
  }

  try {
    const tanggal = $('waDashboardDate')?.value || formatLocalDateForInput(new Date());
    const statusKirim = $('waHistoryStatus')?.value || '';
    const jenisWA = $('waHistoryType')?.value || '';
    const search = $('waHistorySearch')?.value || '';

    const result = await apiGet({
      action: 'waHistory',
      token: currentToken,
      tanggal: tanggal,
      statusKirim: statusKirim,
      jenisWA: jenisWA,
      search: search,
      limit: 200
    });

    if (result?.status === 'SESSION_EXPIRED') {
      handleSessionExpired();
      return;
    }

    if (!result || !result.success) {
      throw new Error(result?.message || 'Riwayat WA tidak dapat dimuat.');
    }

    waCenterHistoryData = Array.isArray(result.data) ? result.data : [];
    renderWAHistory();
    setWAMessage('waHistoryMessage', 'Riwayat diperbarui.', 'success');

  } catch (error) {
    console.error('WA HISTORY ERROR:', error);
    wrap.innerHTML = '<div class="app-error">❌ ' + escapeHTML(error.message || 'Gagal memuat riwayat.') + '</div>';
    setWAMessage('waHistoryMessage', error.message || 'Gagal memuat riwayat.', 'error');
  } finally {
    waCenterHistoryLoading = false;
    if (button) {
      button.disabled = false;
      button.textContent = '🔍 Tampilkan';
    }
  }
}


function renderWAHistory() {

  const wrap = $('waHistoryTableWrap');
  if (!wrap) return;

  setText('waHistoryCount', waCenterHistoryData.length + ' data');

  if (!waCenterHistoryData.length) {
    wrap.innerHTML = '<div class="wa-history-empty">📭 Belum ada log WhatsApp untuk filter yang dipilih.</div>';
    return;
  }

  wrap.innerHTML = `
    <div class="wa-history-table-scroll">
      <table class="wa-history-table">
        <thead>
          <tr>
            <th>Waktu</th>
            <th>Siswa</th>
            <th>Orang Tua / WA</th>
            <th>Jenis</th>
            <th>Status</th>
            <th>Pesan</th>
            <th>Petugas</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody>
          ${waCenterHistoryData.map(renderWAHistoryRow).join('')}
        </tbody>
      </table>
    </div>
  `;

  wrap.querySelectorAll('[data-wa-resend]').forEach(function(button) {
    button.addEventListener('click', function() {
      resendWAFromDashboard(button.dataset.waResend);
    });
  });
}


function renderWAHistoryRow(item) {
  const status = String(item.statusKirim || '').trim().toUpperCase();
  const canResend = status === 'GAGAL' || status === 'FAILED';
  const statusClass = status === 'TERKIRIM' || status === 'SENT'
    ? 'sent'
    : (status === 'GAGAL' || status === 'FAILED' ? 'failed' : 'pending');

  const message = String(item.pesan || '');
  const shortMessage = message.length > 100 ? message.slice(0, 100) + '…' : message;

  return `
    <tr>
      <td><strong>${escapeHTML(item.jam || '-')}</strong><small>${escapeHTML(item.tanggal || '-')}</small></td>
      <td><strong>${escapeHTML(item.nama || '-')}</strong><small>${escapeHTML(item.studentId || '-')} • ${escapeHTML(item.kelas || '-')}</small></td>
      <td>${escapeHTML(item.noWa || '-')}</td>
      <td><span class="wa-type-badge">${escapeHTML(item.jenisWA || '-')}</span></td>
      <td><span class="wa-status-badge ${statusClass}">${escapeHTML(item.statusKirim || '-')}</span></td>
      <td><div class="wa-message-preview" title="${escapeHTML(message)}">${escapeHTML(shortMessage || '-')}</div></td>
      <td>${escapeHTML(item.petugas || '-')}</td>
      <td>
        ${canResend
          ? '<button type="button" class="wa-resend-button" data-wa-resend="' + escapeHTML(item.waLogId) + '">🔄 Kirim Ulang</button>'
          : '<span class="wa-no-action">-</span>'}
      </td>
    </tr>
  `;
}


async function resendWAFromDashboard(waLogId) {

  if (!waLogId || !currentToken) return;
  if (!confirm('Kirim ulang pesan WhatsApp yang gagal?')) return;

  try {
    const result = await apiGet({
      action: 'resendWA',
      token: currentToken,
      waLogId: waLogId
    }, { timeoutMs: 30000 });

    if (result?.status === 'SESSION_EXPIRED') {
      handleSessionExpired();
      return;
    }

    if (!result || !result.success) {
      throw new Error(result?.message || 'Pesan gagal dikirim ulang.');
    }

    setWAMessage('waHistoryMessage', '✅ Pesan berhasil dikirim ulang.', 'success');
    await loadWACenterDashboard(true);

  } catch (error) {
    console.error('WA RESEND ERROR:', error);
    setWAMessage('waHistoryMessage', error.message || 'Gagal mengirim ulang.', 'error');
  }
}


function setWAMessage(id, text, type) {
  const el = $(id);
  if (!el) return;
  el.textContent = text || '';
  el.className = 'wa-message-box' + (type ? ' ' + type : '');
}


/* ============================================================
   43. CSS DINAMIS DASHBOARD
============================================================ */


function injectDashboardStyles() {

  if (
    $('appDynamicStyles')
  ) {
    return;
  }


  const style =
    document.createElement(
      'style'
    );


  style.id =
    'appDynamicStyles';


  style.textContent = `

    /* ==========================================================
       WHATSAPP CENTER ADMIN - STANDALONE PAGE
    ========================================================== */
    .wa-center-page {
      display:flex;
      flex-direction:column;
      width:100%;
      min-height:100vh;
      box-sizing:border-box;
      padding:20px 16px 0;
      background:#f1f5f9;
      color:#0f172a;
    }
    .wa-page-shell {
      width:min(1220px,100%);
      margin:0 auto;
      flex:1 0 auto;
    }
    .wa-page-footer {
      width:min(1220px,100%);
      margin:24px auto 0;
      padding:18px 12px 22px;
      text-align:center;
      box-sizing:border-box;
      color:#64748b;
      border-top:1px solid #e2e8f0;
    }
    .wa-page-footer-name {
      font-size:13px;
      font-weight:800;
      letter-spacing:.25px;
      color:#0f766e;
    }
    .wa-page-footer-meta {
      margin-top:4px;
      font-size:11px;
      line-height:1.5;
    }
    .wa-page-topbar {
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:18px;
      padding:20px 22px;
      border-radius:18px;
      background:#ffffff;
      border:1px solid #e2e8f0;
      box-shadow:0 8px 24px rgba(15,23,42,.06);
    }
    .wa-page-kicker {font-size:11px;font-weight:800;letter-spacing:.08em;color:#64748b;}
    .wa-page-title {font-size:26px;font-weight:850;color:#0f172a;margin-top:3px;}
    .wa-page-subtitle {font-size:13px;color:#64748b;margin-top:4px;}
    .wa-page-top-actions {display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;}
    .wa-back-button {border:1px solid #cbd5e1;border-radius:10px;padding:10px 13px;background:#0f172a;color:#fff;font-weight:700;cursor:pointer;font:inherit;}
    .wa-back-button:hover {filter:brightness(1.08);}
    .wa-launcher {
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:16px;
      margin:0 0 14px;
      padding:15px 17px;
      border:1px solid #dbeafe;
      border-radius:16px;
      background:linear-gradient(135deg,#eff6ff,#ffffff);
      box-shadow:0 7px 20px rgba(15,23,42,.05);
    }
    .wa-launcher-title {font-size:16px;font-weight:800;color:#0f172a;}
    .wa-launcher-subtitle {font-size:12px;color:#64748b;margin-top:3px;line-height:1.45;}
    .wa-open-button {border:0;border-radius:10px;padding:11px 15px;background:#2563eb;color:#fff;font-weight:400;cursor:pointer;font:inherit;white-space:nowrap;box-shadow:0 5px 12px rgba(37,99,235,.18);}
    .wa-open-button:hover {filter:brightness(.97);}
    .wa-center-page .wa-center-panel {margin-top:0;}
    .wa-center-page .wa-stat-grid {grid-template-columns:repeat(6,minmax(0,1fr));}
    @media (max-width: 1050px) {
      .wa-center-page .wa-stat-grid {grid-template-columns:repeat(3,minmax(0,1fr));}
      .wa-page-topbar {align-items:flex-start;flex-direction:column;}
      .wa-page-top-actions {justify-content:flex-start;}
    }
    @media (max-width: 760px) {
      .wa-center-page {padding:12px 10px 0;}
      .wa-page-topbar {padding:16px;}
      .wa-page-title {font-size:22px;}
      .wa-page-top-actions {width:100%;}
      .wa-page-top-actions > * {flex:1 1 auto;}
      .wa-center-page .wa-stat-grid {grid-template-columns:repeat(2,minmax(0,1fr));}
      .wa-launcher {align-items:stretch;flex-direction:column;}
      .wa-open-button {width:100%;}
    }
    @media (max-width: 480px) {
      .wa-center-page .wa-stat-grid {grid-template-columns:1fr 1fr;}
      .wa-page-top-actions {display:grid;grid-template-columns:1fr 1fr;}
      .wa-page-top-actions .wa-connection-badge {grid-column:1 / -1;}
    }

    /* ==========================================================
       WHATSAPP CENTER ADMIN - LEGACY COMPONENT STYLES
    ========================================================== */
    .wa-center-panel {
      margin-top: 18px;
      padding: 18px;
      border: 1px solid #dbeafe;
      border-radius: 20px;
      background: linear-gradient(145deg,#ffffff,#f8fbff);
      box-shadow: 0 10px 30px rgba(15,23,42,.07);
    }
    .wa-center-header,.wa-history-header {
      display:flex;
      align-items:flex-start;
      justify-content:space-between;
      gap:14px;
      flex-wrap:wrap;
    }
    .wa-center-title {font-size:22px;font-weight:800;color:#0f172a;}
    .wa-center-subtitle,.wa-box-subtitle {margin-top:4px;color:#64748b;font-size:13px;line-height:1.5;}
    .wa-center-header-actions {display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
    .wa-connection-badge,.wa-status-badge,.wa-type-badge {display:inline-flex;align-items:center;justify-content:center;border-radius:999px;font-weight:700;font-size:12px;}
    .wa-connection-badge {padding:8px 12px;background:#f1f5f9;color:#475569;}
    .wa-connection-badge.success {background:#dcfce7;color:#166534;}
    .wa-connection-badge.warning {background:#fef3c7;color:#92400e;}
    .wa-connection-badge.danger {background:#fee2e2;color:#991b1b;}
    .wa-date-row {display:flex;align-items:end;gap:12px;flex-wrap:wrap;margin-top:16px;}
    .wa-field {display:flex;flex-direction:column;gap:6px;min-width:0;}
    .wa-field > span {font-size:12px;font-weight:700;color:#475569;}
    .wa-field input,.wa-field select,.wa-field textarea {box-sizing:border-box;width:100%;border:1px solid #cbd5e1;border-radius:10px;background:#fff;padding:10px 11px;color:#0f172a;font:inherit;outline:none;}
    .wa-field input:focus,.wa-field select:focus,.wa-field textarea:focus {border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.10);}
    .wa-date-field {width:180px;}
    .wa-inline-message {font-size:12px;color:#64748b;min-height:20px;padding-bottom:3px;}
    .wa-inline-message.success {color:#15803d;}
    .wa-inline-message.error {color:#b91c1c;}
    .wa-stat-grid {display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin-top:16px;}
    .wa-stat-card {padding:13px;border:1px solid #e2e8f0;border-radius:14px;background:#fff;min-width:0;}
    .wa-stat-card span {display:block;font-size:12px;color:#475569;font-weight:700;}
    .wa-stat-card strong {display:block;font-size:27px;line-height:1.15;margin-top:4px;color:#0f172a;}
    .wa-stat-card small {display:block;color:#94a3b8;font-size:11px;margin-top:4px;}
    .wa-stat-sent strong {color:#15803d;}.wa-stat-failed strong{color:#dc2626;}.wa-stat-pending strong{color:#d97706;}.wa-stat-manual strong{color:#2563eb;}
    .wa-center-grid {display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr);gap:14px;margin-top:14px;}
    .wa-box {padding:16px;border:1px solid #e2e8f0;border-radius:16px;background:#fff;}
    .wa-box-title {font-size:17px;font-weight:800;color:#0f172a;}
    .wa-manual-box .wa-field,.wa-settings-box .wa-field {margin-top:13px;}
    .wa-recipient-info {display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;padding:11px;border-radius:11px;background:#f8fafc;border:1px solid #e2e8f0;font-size:12px;color:#475569;}
    .wa-recipient-info strong {color:#0f172a;}.wa-recipient-info span {padding-left:8px;border-left:1px solid #cbd5e1;}
    .wa-char-counter {text-align:right;color:#94a3b8;font-size:11px;margin-top:3px;}
    .wa-message-box {min-height:20px;margin-top:10px;font-size:12px;color:#64748b;line-height:1.5;}
    .wa-message-box.success {color:#15803d;background:#f0fdf4;border:1px solid #bbf7d0;padding:9px;border-radius:9px;}
    .wa-message-box.error {color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;padding:9px;border-radius:9px;}
    .wa-primary-button,.wa-secondary-button,.wa-resend-button {border:0;border-radius:10px;padding:10px 13px;font-weight:700;cursor:pointer;font:inherit;}
    .wa-primary-button {background:#2563eb;color:#fff;width:100%;margin-top:7px;box-shadow:0 5px 12px rgba(37,99,235,.18);}
    .wa-primary-button:hover {filter:brightness(.97);}.wa-primary-button:disabled,.wa-secondary-button:disabled{opacity:.6;cursor:wait;}
    .wa-secondary-button {background:#f1f5f9;color:#334155;border:1px solid #e2e8f0;}
    .wa-setting-main {margin-top:14px;padding:11px;border-radius:12px;background:#eff6ff;border:1px solid #bfdbfe;}
    .wa-setting-list {margin-top:9px;display:grid;gap:7px;}
    .wa-switch-row {display:flex;align-items:center;gap:9px;cursor:pointer;}
    .wa-switch-row input {position:absolute;opacity:0;pointer-events:none;}
    .wa-switch-ui {width:38px;height:21px;border-radius:99px;background:#cbd5e1;position:relative;flex:none;transition:.18s;}
    .wa-switch-ui:after {content:"";position:absolute;width:17px;height:17px;left:2px;top:2px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2);transition:.18s;}
    .wa-switch-row input:checked + .wa-switch-ui {background:#16a34a;}.wa-switch-row input:checked + .wa-switch-ui:after {transform:translateX(17px);}
    .wa-switch-row strong {display:block;font-size:13px;color:#0f172a;}.wa-switch-row small {display:block;color:#64748b;font-size:11px;margin-top:2px;}
    .wa-rule-title {margin-top:15px;font-size:13px;font-weight:800;color:#334155;}
    .wa-rule-grid {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:9px;}
    .wa-rule-item {display:flex;align-items:center;gap:8px;padding:8px 9px;border:1px solid #e2e8f0;border-radius:9px;background:#fafafa;font-size:10px;font-weight:700;color:#475569;cursor:pointer;}
    .wa-rule-item input {accent-color:#2563eb;}
    .wa-history-box {margin-top:14px;}
    .wa-history-count {padding:7px 10px;border-radius:999px;background:#f1f5f9;color:#475569;font-size:12px;font-weight:700;}
    .wa-history-filters {display:grid;grid-template-columns:170px 170px minmax(180px,1fr) auto;gap:9px;align-items:end;margin-top:14px;}
    .wa-history-table-wrap {margin-top:10px;}
    .wa-history-table-scroll {overflow-x:auto;border:1px solid #e2e8f0;border-radius:12px;}
    .wa-history-table {width:100%;min-width:1050px;border-collapse:collapse;font-size:12px;}
    .wa-history-table th,.wa-history-table td {padding:9px 10px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top;}
    .wa-history-table th {background:#f8fafc;color:#475569;font-size:11px;white-space:nowrap;}
    .wa-history-table tbody tr:hover {background:#f8fafc;}
    .wa-history-table td strong {display:block;color:#0f172a;}.wa-history-table td small {display:block;color:#94a3b8;margin-top:2px;}
    .wa-status-badge {padding:5px 8px;}.wa-status-badge.sent {background:#dcfce7;color:#166534;}.wa-status-badge.failed{background:#fee2e2;color:#991b1b;}.wa-status-badge.pending{background:#fef3c7;color:#92400e;}
    .wa-type-badge {padding:5px 8px;background:#eff6ff;color:#1d4ed8;}
    .wa-message-preview {max-width:280px;white-space:normal;line-height:1.45;color:#475569;}
    .wa-resend-button {padding:7px 9px;background:#fff7ed;color:#c2410c;border:1px solid #fed7aa;white-space:nowrap;font-size:11px;}
    .wa-no-action {color:#cbd5e1;}
    .wa-history-empty {padding:28px;text-align:center;color:#64748b;background:#f8fafc;border-radius:12px;}

    .app-loading {
      padding: 20px;
      text-align: center;
      color: #64748b;
    }

    .app-empty {
      padding: 20px;
      text-align: center;
      color: #64748b;
      background: #f8fafc;
      border-radius: 12px;
    }

    .app-error {
      padding: 15px;
      text-align: center;
      color: #b91c1c;
      background: #fef2f2;
      border-radius: 12px;
    }

    .teacher-schedule-card {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px;
      margin-bottom: 10px;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      background: #ffffff;
      cursor: pointer;
      text-align: left;
      transition: 0.2s ease;
    }

    .teacher-schedule-card:hover {
      transform: translateY(-1px);
      box-shadow: 0 5px 15px rgba(0,0,0,.08);
    }

    .teacher-schedule-card.selected {
      border-color: #2563eb;
      background: #eff6ff;
    }

    .schedule-number {
      width: 34px;
      height: 34px;
      min-width: 34px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      background: #2563eb;
      color: #fff;
      font-weight: 700;
    }

    .schedule-main {
      flex: 1;
    }

    .schedule-time {
      font-size: 13px;
      color: #64748b;
    }

    .schedule-mapel {
      font-size: 16px;
      font-weight: 700;
      margin-top: 3px;
    }

    .schedule-class {
      font-size: 13px;
      color: #475569;
      margin-top: 3px;
    }

    .schedule-ke {
      font-size: 12px;
      color: #64748b;
      white-space: nowrap;
    }

    #teacherStats {
      display: grid;
      grid-template-columns: repeat(auto-fit,minmax(110px,1fr));
      gap: 8px;
      margin: 12px 0;
    }

    .teacher-stat {
      padding: 10px;
      background: #f8fafc;
      border-radius: 10px;
      text-align: center;
    }

    .teacher-stat span {
      display: block;
      font-size: 12px;
      color: #64748b;
    }

    .teacher-stat strong {
      display: block;
      font-size: 20px;
      margin-top: 3px;
    }

    .teacher-attendance-table-wrapper {
      width: 100%;
      overflow-x: auto;
    }

    .teacher-attendance-table {
      width: 100%;
      border-collapse: collapse;
      min-width: 760px;
    }

    .teacher-attendance-table th,
    .teacher-attendance-table td {
      padding: 9px;
      border-bottom: 1px solid #e2e8f0;
      text-align: left;
      vertical-align: middle;
    }

    .teacher-attendance-table th {
      background: #f8fafc;
      font-size: 13px;
    }

    .teacher-student-name {
      font-weight: 700;
    }

    .teacher-student-id {
      color: #64748b;
      font-size: 11px;
      margin-top: 2px;
    }

    .attendance-status-select,
    .attendance-note-input {
      width: 100%;
      padding: 8px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      background: #fff;
      box-sizing: border-box;
    }

    .attendance-status-select {
      min-width: 125px;
    }

    .attendance-note-input {
      min-width: 160px;
    }

    .save-attendance-button {
      border: 0;
      border-radius: 8px;
      padding: 8px 11px;
      cursor: pointer;
      background: #2563eb;
      color: white;
      font-weight: 600;
      white-space: nowrap;
    }

    .save-attendance-button:disabled {
      opacity: .6;
      cursor: wait;
    }

    .teacher-save-all-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 14px;
      padding: 12px;
      border-radius: 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
    }

    .teacher-save-all-button {
      border: 0;
      border-radius: 9px;
      padding: 10px 16px;
      background: #0f766e;
      color: #fff;
      font-weight: 800;
      cursor: pointer;
    }

    .teacher-save-all-button:disabled {
      opacity: .65;
      cursor: wait;
    }

    .teacher-save-all-hint {
      color: #64748b;
      font-size: 12px;
    }

    .teacher-row-dirty {
      background: #fffbeb;
    }

    .attendance-status-badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 12px;
      white-space: nowrap;
    }

    .status-hadir {
      background: #dcfce7;
    }

    .status-terlambat {
      background: #fef3c7;
    }

    .status-izin {
      background: #dbeafe;
    }

    .status-sakit {
      background: #ede9fe;
    }

    .status-alpa {
      background: #fee2e2;
    }

    .status-kegiatan {
      background: #ffedd5;
    }

    .status-belum,
    .status-default {
      background: #f1f5f9;
    }

    .teacher-monthly-recap-panel {
      margin: 14px 0;
      padding: 16px;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      background: #ffffff;
      box-shadow: 0 5px 18px rgba(0,0,0,.05);
    }

    .teacher-recap-title {
      font-size: 17px;
      font-weight: 800;
    }

    .teacher-recap-subtitle {
      margin-top: 4px;
      color: #64748b;
      font-size: 12px;
      line-height: 1.5;
    }

    .teacher-recap-controls {
      display: grid;
      grid-template-columns: repeat(4, minmax(120px, 1fr)) auto;
      gap: 10px;
      align-items: end;
      margin-top: 13px;
    }

    .teacher-recap-field span {
      display: block;
      margin-bottom: 5px;
      font-size: 12px;
      color: #475569;
      font-weight: 700;
    }

    .teacher-recap-field select {
      width: 100%;
      box-sizing: border-box;
      padding: 9px 10px;
      border: 1px solid #cbd5e1;
      border-radius: 9px;
      background: #fff;
    }

    .teacher-recap-button {
      border: 0;
      border-radius: 9px;
      padding: 10px 14px;
      background: #2563eb;
      color: #fff;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
    }

    .teacher-recap-button:disabled {
      opacity: .65;
      cursor: wait;
    }

    .teacher-recap-message {
      min-height: 20px;
      margin-top: 10px;
      font-size: 13px;
      line-height: 1.5;
    }

    .teacher-recap-message.loading { color: #92400e; }
    .teacher-recap-message.success { color: #166534; }
    .teacher-recap-message.error { color: #b91c1c; }

    .teacher-recap-result {
      margin-top: 12px;
    }

    .teacher-recap-summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
      gap: 8px;
      margin-bottom: 12px;
    }

    .teacher-recap-summary > div {
      padding: 9px;
      border-radius: 10px;
      background: #f8fafc;
      text-align: center;
    }

    .teacher-recap-summary span {
      display: block;
      font-size: 11px;
      color: #64748b;
    }

    .teacher-recap-summary strong {
      display: block;
      margin-top: 3px;
      font-size: 18px;
    }

    .teacher-recap-table-wrapper {
      width: 100%;
      overflow-x: auto;
    }

    .teacher-recap-table {
      width: 100%;
      border-collapse: collapse;
      min-width: 900px;
    }

    .teacher-recap-table th,
    .teacher-recap-table td {
      padding: 8px 9px;
      border-bottom: 1px solid #e2e8f0;
      text-align: center;
      vertical-align: middle;
      font-size: 12px;
    }

    .teacher-recap-table th {
      background: #f8fafc;
      font-weight: 800;
    }

    .teacher-recap-table th:nth-child(2),
    .teacher-recap-table td:nth-child(2) {
      text-align: left;
    }

    .teacher-recap-student-id {
      color: #64748b;
      font-size: 10px;
      margin-top: 2px;
    }

    .teacher-recap-empty {
      padding: 18px;
      text-align: center;
      color: #64748b;
      background: #f8fafc;
      border-radius: 12px;
    }

    .teacher-recap-download-wrap,
    .admin-recap-download-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 12px;
      padding: 10px 12px;
      border: 1px solid #dcfce7;
      border-radius: 11px;
      background: #f0fdf4;
    }

    .teacher-recap-download-button,
    .admin-recap-download-button {
      border: 0;
      border-radius: 9px;
      padding: 10px 14px;
      background: #15803d;
      color: #fff;
      font-weight: 800;
      cursor: pointer;
      white-space: nowrap;
    }

    .teacher-recap-download-button:disabled,
    .admin-recap-download-button:disabled {
      opacity: .65;
      cursor: wait;
    }

    .teacher-recap-download-message,
    .admin-recap-download-message {
      font-size: 12px;
      color: #475569;
      line-height: 1.5;
    }

    .teacher-recap-download-message.loading,
    .admin-recap-download-message.loading { color: #92400e; }
    .teacher-recap-download-message.success,
    .admin-recap-download-message.success { color: #166534; }
    .teacher-recap-download-message.error,
    .admin-recap-download-message.error { color: #b91c1c; }

    .admin-monthly-recap-panel {
      margin: 14px 0;
      padding: 16px;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      background: #ffffff;
      box-shadow: 0 5px 18px rgba(0,0,0,.05);
    }

    .admin-recap-title {
      font-size: 17px;
      font-weight: 800;
    }

    .admin-recap-subtitle {
      margin-top: 4px;
      color: #64748b;
      font-size: 12px;
      line-height: 1.5;
    }

    .admin-recap-controls {
      display: grid;
      grid-template-columns: 1fr 1fr auto;
      gap: 10px;
      align-items: end;
      margin-top: 13px;
    }

    .admin-recap-field span {
      display: block;
      margin-bottom: 5px;
      font-size: 12px;
      color: #475569;
      font-weight: 700;
    }

    .admin-recap-field select {
      width: 100%;
      box-sizing: border-box;
      padding: 9px 10px;
      border: 1px solid #cbd5e1;
      border-radius: 9px;
      background: #fff;
    }

    .admin-recap-button {
      border: 0;
      border-radius: 9px;
      padding: 10px 14px;
      background: #2563eb;
      color: #fff;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
    }

    .admin-recap-button:disabled {
      opacity: .65;
      cursor: wait;
    }

    .admin-recap-message {
      min-height: 20px;
      margin-top: 10px;
      font-size: 13px;
      line-height: 1.5;
    }

    .admin-recap-message.loading {
      color: #92400e;
    }

    .admin-recap-message.success {
      color: #166534;
    }

    .admin-recap-message.error {
      color: #b91c1c;
    }

    .admin-recap-progress-wrap {
      margin-top: 12px;
      padding: 11px 12px;
      border-radius: 10px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
    }

    .admin-recap-progress-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      font-size: 12px;
      color: #475569;
      margin-bottom: 7px;
    }

    .admin-recap-progress-top strong {
      font-size: 13px;
      color: #2563eb;
      min-width: 38px;
      text-align: right;
    }

    .admin-recap-progress-track {
      width: 100%;
      height: 10px;
      overflow: hidden;
      border-radius: 999px;
      background: #e2e8f0;
    }

    .admin-recap-progress-bar {
      height: 100%;
      width: 0%;
      border-radius: 999px;
      background: linear-gradient(90deg, #2563eb, #16a34a);
      transition: width .35s ease;
    }



    /* ==========================================================
       DASHBOARD KEPALA SEKOLAH
    ========================================================== */
    .principal-teacher-dashboard-panel {
      margin: 14px 0;
      padding: 18px;
      border: 1px solid #dbeafe;
      border-radius: 18px;
      background: linear-gradient(145deg,#ffffff,#f8fbff);
      box-shadow: 0 7px 22px rgba(15,23,42,.06);
    }

    .principal-dashboard-header {
      display:flex;
      align-items:flex-start;
      justify-content:space-between;
      gap:16px;
    }

    .principal-dashboard-kicker {
      font-size:10px;
      font-weight:900;
      letter-spacing:.12em;
      color:#2563eb;
    }

    .principal-dashboard-title {
      margin-top:3px;
      font-size:20px;
      font-weight:900;
      color:#0f172a;
    }

    .principal-dashboard-subtitle {
      margin-top:5px;
      max-width:900px;
      font-size:12px;
      line-height:1.55;
      color:#64748b;
    }

    .principal-dashboard-controls {
      display:grid;
      grid-template-columns:1fr 1fr auto;
      gap:10px;
      align-items:end;
      margin-top:15px;
    }

    .principal-dashboard-field span {
      display:block;
      margin-bottom:5px;
      font-size:12px;
      font-weight:800;
      color:#475569;
    }

    .principal-dashboard-field input {
      width:100%;
      box-sizing:border-box;
      padding:10px 11px;
      border:1px solid #cbd5e1;
      border-radius:10px;
      background:#fff;
      color:#0f172a;
      font:inherit;
    }

    .principal-dashboard-button {
      border:0;
      border-radius:10px;
      padding:11px 15px;
      background:#2563eb;
      color:#fff;
      font-weight:800;
      cursor:pointer;
      white-space:nowrap;
      font:inherit;
      box-shadow:0 5px 12px rgba(37,99,235,.18);
    }

    .principal-dashboard-button:hover {
      filter:brightness(1.05);
    }

    .principal-dashboard-button:disabled {
      opacity:.65;
      cursor:wait;
    }

    .principal-teacher-dashboard-message {
      min-height:20px;
      margin-top:10px;
      font-size:13px;
      line-height:1.5;
    }

    .principal-teacher-dashboard-message.loading {
      color:#92400e;
    }

    .principal-teacher-dashboard-message.success {
      color:#166534;
    }

    .principal-teacher-dashboard-message.error {
      color:#b91c1c;
    }

    .principal-summary-grid {
      display:grid;
      grid-template-columns:repeat(7,minmax(0,1fr));
      gap:9px;
      margin-top:14px;
    }

    .principal-summary-card {
      min-width:0;
      padding:12px;
      border:1px solid #e2e8f0;
      border-radius:14px;
      background:#fff;
    }

    .principal-summary-card.hadir {
      background:#f0fdf4;
      border-color:#bbf7d0;
    }

    .principal-summary-card.terlambat {
      background:#fffbeb;
      border-color:#fde68a;
    }

    .principal-summary-card.izin {
      background:#eff6ff;
      border-color:#bfdbfe;
    }

    .principal-summary-card.sakit {
      background:#f5f3ff;
      border-color:#ddd6fe;
    }

    .principal-summary-card.alpa {
      background:#fef2f2;
      border-color:#fecaca;
    }

    .principal-summary-card.percentage {
      background:#f0fdfa;
      border-color:#99f6e4;
    }

    .principal-summary-icon {
      font-size:18px;
    }

    .principal-summary-label {
      margin-top:4px;
      font-size:11px;
      font-weight:800;
      color:#64748b;
    }

    .principal-summary-value {
      margin-top:2px;
      font-size:20px;
      font-weight:900;
      color:#0f172a;
    }

    .principal-summary-note {
      margin-top:2px;
      font-size:9px;
      line-height:1.35;
      color:#94a3b8;
    }

    .principal-result-heading {
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:12px;
      margin:18px 0 10px;
    }

    .principal-result-title {
      font-size:16px;
      font-weight:900;
      color:#0f172a;
    }

    .principal-result-subtitle {
      margin-top:3px;
      font-size:11px;
      color:#64748b;
    }

    .principal-result-badge {
      padding:7px 10px;
      border-radius:999px;
      background:#eff6ff;
      color:#1d4ed8;
      font-size:11px;
      font-weight:900;
      white-space:nowrap;
    }

    .principal-table-wrap,
    .principal-detail-table-wrap {
      width:100%;
      overflow:auto;
      border:1px solid #e2e8f0;
      border-radius:12px;
      background:#fff;
    }

    .principal-teacher-table,
    .principal-detail-table {
      width:100%;
      border-collapse:collapse;
      min-width:1080px;
    }

    .principal-teacher-table th,
    .principal-teacher-table td,
    .principal-detail-table th,
    .principal-detail-table td {
      padding:9px 8px;
      border-bottom:1px solid #eef2f7;
      text-align:left;
      font-size:11px;
      vertical-align:middle;
    }

    .principal-teacher-table th,
    .principal-detail-table th {
      background:#f8fafc;
      color:#475569;
      font-size:10px;
      font-weight:900;
      white-space:nowrap;
    }

    .principal-teacher-table tbody tr:hover,
    .principal-detail-table tbody tr:hover {
      background:#f8fbff;
    }

    .principal-teacher-table .num {
      text-align:center;
      font-variant-numeric:tabular-nums;
    }

    .principal-rank {
      width:28px;
      text-align:center !important;
      font-weight:900;
      color:#64748b;
    }

    .principal-guru-name {
      font-weight:800;
      color:#0f172a;
    }

    .principal-guru-id {
      margin-top:2px;
      font-size:9px;
      color:#94a3b8;
    }

    .principal-percentage {
      display:inline-block;
      min-width:58px;
      padding:5px 7px;
      border-radius:999px;
      text-align:center;
      font-weight:900;
      font-size:10px;
    }

    .principal-percentage.good {
      background:#dcfce7;
      color:#166534;
    }

    .principal-percentage.warning {
      background:#fef3c7;
      color:#92400e;
    }

    .principal-percentage.danger {
      background:#fee2e2;
      color:#b91c1c;
    }

    .principal-detail-button {
      border:1px solid #bfdbfe;
      border-radius:8px;
      padding:7px 9px;
      background:#eff6ff;
      color:#1d4ed8;
      font-weight:800;
      cursor:pointer;
      font:inherit;
      white-space:nowrap;
    }

    .principal-detail-button:hover {
      background:#dbeafe;
    }

    .principal-teacher-detail-result {
      margin-top:15px;
      padding-top:15px;
      border-top:1px dashed #cbd5e1;
    }

    .principal-detail-header {
      display:flex;
      align-items:flex-start;
      justify-content:space-between;
      gap:14px;
      margin-bottom:12px;
    }

    .principal-detail-kicker {
      font-size:10px;
      font-weight:900;
      letter-spacing:.1em;
      color:#64748b;
    }

    .principal-detail-title {
      margin-top:2px;
      font-size:17px;
      font-weight:900;
      color:#0f172a;
    }

    .principal-detail-subtitle {
      margin-top:4px;
      font-size:11px;
      color:#64748b;
    }

    .principal-close-detail-button {
      border:1px solid #cbd5e1;
      border-radius:9px;
      padding:8px 10px;
      background:#fff;
      color:#475569;
      font-weight:800;
      cursor:pointer;
      font:inherit;
      white-space:nowrap;
    }

    .principal-detail-summary-grid {
      display:grid;
      grid-template-columns:repeat(7,minmax(0,1fr));
      gap:8px;
      margin-bottom:12px;
    }

    .principal-detail-stat {
      padding:10px;
      border:1px solid #e2e8f0;
      border-radius:10px;
      background:#fff;
    }

    .principal-detail-stat span {
      display:block;
      font-size:10px;
      color:#64748b;
      font-weight:800;
    }

    .principal-detail-stat strong {
      display:block;
      margin-top:3px;
      font-size:17px;
      color:#0f172a;
    }

    .principal-detail-stat.hadir {
      background:#f0fdf4;
      border-color:#bbf7d0;
    }

    .principal-detail-stat.terlambat {
      background:#fffbeb;
      border-color:#fde68a;
    }

    .principal-detail-stat.izin {
      background:#eff6ff;
      border-color:#bfdbfe;
    }

    .principal-detail-stat.sakit {
      background:#f5f3ff;
      border-color:#ddd6fe;
    }

    .principal-detail-stat.alpa {
      background:#fef2f2;
      border-color:#fecaca;
    }

    .principal-detail-stat.belum {
      background:#f8fafc;
      border-color:#cbd5e1;
    }

    .principal-detail-status {
      display:inline-block;
      padding:5px 7px;
      border-radius:999px;
      font-size:9px;
      font-weight:900;
      white-space:nowrap;
    }

    .principal-detail-status.hadir {
      background:#dcfce7;
      color:#166534;
    }

    .principal-detail-status.terlambat {
      background:#fef3c7;
      color:#92400e;
    }

    .principal-detail-status.izin {
      background:#dbeafe;
      color:#1d4ed8;
    }

    .principal-detail-status.sakit {
      background:#ede9fe;
      color:#6d28d9;
    }

    .principal-detail-status.alpa {
      background:#fee2e2;
      color:#b91c1c;
    }

    .principal-detail-status.belum {
      background:#f1f5f9;
      color:#64748b;
    }

    .principal-empty-state {
      padding:28px 16px;
      text-align:center;
      border:1px dashed #cbd5e1;
      border-radius:12px;
      background:#f8fafc;
    }

    .principal-empty-icon {
      font-size:28px;
    }

    .principal-empty-title {
      margin-top:5px;
      font-weight:900;
      color:#0f172a;
    }

    .principal-empty-text {
      margin-top:3px;
      font-size:12px;
      color:#64748b;
    }

    .principal-detail-loading,
    .principal-detail-error {
      padding:14px;
      border-radius:10px;
      background:#f8fafc;
      color:#475569;
      font-size:13px;
    }

    .principal-detail-error {
      background:#fef2f2;
      color:#b91c1c;
    }

    @media (max-width: 900px) {
      .principal-summary-grid {
        grid-template-columns:repeat(3,minmax(0,1fr));
      }

      .principal-detail-summary-grid {
        grid-template-columns:repeat(3,minmax(0,1fr));
      }

      .principal-dashboard-controls {
        grid-template-columns:1fr 1fr;
      }

      .principal-dashboard-button {
        grid-column:1 / -1;
      }
    }

    @media (max-width: 600px) {
      .principal-teacher-dashboard-panel {
        padding:13px;
        border-radius:14px;
      }

      .principal-dashboard-controls {
        grid-template-columns:1fr;
      }

      .principal-dashboard-button {
        grid-column:auto;
        width:100%;
      }

      .principal-summary-grid,
      .principal-detail-summary-grid {
        grid-template-columns:repeat(2,minmax(0,1fr));
      }

      .principal-detail-header {
        flex-direction:column;
      }

      .principal-close-detail-button {
        width:100%;
      }
    }


    .teacher-presence-checkin-box {
      margin: 0 0 14px; padding: 14px; border: 1px solid #dbeafe;
      border-radius: 14px; background: linear-gradient(135deg,#eff6ff,#f8fafc);
    }
    .teacher-presence-checkin-head {
      display:flex; align-items:center; justify-content:space-between; gap:12px;
    }
    .teacher-presence-checkin-title { font-size:15px; font-weight:800; color:#0f172a; }
    .teacher-presence-checkin-info { margin-top:4px; color:#64748b; font-size:12px; line-height:1.5; }
    .teacher-presence-status {
      padding:7px 10px; border-radius:999px; font-size:11px; font-weight:800;
      white-space:nowrap; background:#f1f5f9; color:#475569;
    }
    .teacher-presence-status.hadir { background:#dcfce7; color:#166534; }
    .teacher-presence-status.terlambat { background:#fef3c7; color:#92400e; }
    .teacher-presence-status.izin { background:#dbeafe; color:#1d4ed8; }
    .teacher-presence-status.sakit { background:#ede9fe; color:#6d28d9; }
    .teacher-presence-status.alpa { background:#fee2e2; color:#b91c1c; }
    .teacher-presence-checkin-actions { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:12px; }
    .teacher-checkin-button {
      border:0; border-radius:10px; padding:11px 15px; background:#16a34a;
      color:#fff; font-weight:800; cursor:pointer;
    }
    .teacher-checkin-button:disabled { opacity:.65; cursor:wait; }
    .teacher-checkin-message { min-height:20px; font-size:12px; line-height:1.5; }
    .teacher-checkin-message.loading { color:#92400e; }
    .teacher-checkin-message.success { color:#166534; }
    .teacher-checkin-message.error { color:#b91c1c; }

    .app-footer {
      width: 100%;
      box-sizing: border-box;
      margin-top: 24px;
      padding: 12px 16px 16px;
      text-align: center;
      color: #64748b;
      font-size: 11px;
      line-height: 1.6;
      border-top: 1px solid #e2e8f0;
      background: rgba(255,255,255,.96);
      backdrop-filter: blur(5px);
      z-index: 20;
    }

    .app-footer-name {
      font-weight: 800;
      letter-spacing: .3px;
      color: #0f766e;
    }

    .app-footer-meta {
      margin-top: 2px;
    }

    @media (max-width: 900px) {

      .teacher-recap-controls {
        grid-template-columns: 1fr 1fr;
      }

      .teacher-recap-button {
        width: 100%;
        grid-column: 1 / -1;
      }

    }

    @media (max-width: 700px) {

      .admin-recap-controls {
        grid-template-columns: 1fr 1fr;
      }

      .admin-recap-button {
        width: 100%;
        grid-column: 1 / -1;
      }

      .teacher-recap-download-button,
      .admin-recap-download-button {
        width: 100%;
      }

      .teacher-recap-download-wrap,
      .admin-recap-download-wrap {
        align-items: stretch;
      }

      .teacher-presence-checkin-head { align-items:flex-start; flex-direction:column; }
      .teacher-checkin-button { width:100%; }

      .teacher-schedule-card {
        padding: 11px;
      }

      .schedule-ke {
        display: none;
      }

      .teacher-attendance-table-wrapper {
        margin-left: -5px;
        margin-right: -5px;
      }

    }

  `;


  document.head.appendChild(
    style
  );
}


/* ============================================================
   43. EVENT LISTENER
============================================================ */

function bindEvents() {

  /*
   * LOGIN BUTTON
   */

  const loginButton =
    $('loginButton');


  if (loginButton) {

    loginButton.addEventListener(
      'click',
      function () {

        openLoginModal();

      }
    );
  }


  /*
   * CLOSE LOGIN
   */

  const closeLoginButton =
    $('closeLoginButton');


  if (closeLoginButton) {

    closeLoginButton.addEventListener(
      'click',
      function () {

        closeLoginModal();

      }
    );
  }


  /*
   * LOGIN FORM
   */

  const loginForm =
    $('loginForm');


  if (loginForm) {

    loginForm.addEventListener(
      'submit',
      function (event) {

        event.preventDefault();

        loginUser();

      }
    );
  }


  /*
   * KLIK LUAR MODAL
   */

  const loginModal =
    $('loginModal');


  if (loginModal) {

    loginModal.addEventListener(
      'click',
      function (event) {

        if (
          event.target ===
          loginModal
        ) {

          closeLoginModal();
        }
      }
    );
  }


  /*
   * START SCANNER
   */

  const startButton =
    $('startButton');


  if (startButton) {

    startButton.addEventListener(
      'click',
      async function () {

        prepareSpeech();

        speak(
          'Scanner siap'
        );


        await startScanner();

      }
    );
  }


  /*
   * SCAN LAGI
   */

  const scanAgainButton =
    $('scanAgainButton');


  if (scanAgainButton) {

    scanAgainButton.addEventListener(
      'click',
      async function () {

        await restartScanner();

      }
    );
  }


  /*
   * AUTO SCAN
   */

  const autoScanToggle =
    $('autoScanToggle');


  if (autoScanToggle) {

    autoScanToggle.addEventListener(
      'change',
      function () {

        updateAutoScanLabel();

      }
    );
  }


  /*
   * LIMIT ABSENSI
   */

  const attendanceLimit =
    $('attendanceLimit');


  if (attendanceLimit) {

    attendanceLimit.addEventListener(
      'change',
      function () {

        renderTodayAttendance();

      }
    );
  }


  /*
   * LOGOUT
   */

  const logoutButton =
    $('logoutButton');


  if (logoutButton) {

    logoutButton.addEventListener(
      'click',
      function () {

        logoutUser();

      }
    );
  }


  /*
   * JADWAL GURU
   */

  const teacherSchedules =
    $('teacherSchedules');


  if (teacherSchedules) {

    teacherSchedules.addEventListener(
      'click',
      function (event) {

        const card =
          event.target.closest(
            '[data-schedule-id]'
          );


        if (!card) {
          return;
        }


        selectTeacherSchedule(
          card.dataset.scheduleId
        );

      }
    );
  }


  /*
   * RESIZE LAYOUT PUBLIC
   */

  window.addEventListener(
    'resize',
    function () {
      updateTodayAttendanceLayout();
    }
  );


  /*
   * ESC
   */

  document.addEventListener(
    'keydown',
    function (event) {

      if (
        event.key === 'Escape'
      ) {

        closeLoginModal();
      }
    }
  );
}


/* ============================================================
   44. AUTO REFRESH
============================================================ */

function startAutoRefresh() {

  clearInterval(
    refreshTimer
  );


  refreshTimer =
    setInterval(
      async function () {

        try {

          const dashboard = $('dashboard');
          const dashboardVisible =
            dashboard &&
            dashboard.style.display !== 'none';

          if (waCenterStandaloneVisible && currentToken && String(currentUser?.role || '').toUpperCase() === 'ADMIN') {
            await loadWACenterDashboard(false);
          } else if (!dashboardVisible) {
            await loadTodaySummary();
            await loadTodayAttendance();
          }


        } catch (error) {

          console.warn(
            'Auto refresh error:',
            error
          );
        }

      },
      REFRESH_INTERVAL
    );
}



/* ============================================================
   V20.7 - DASHBOARD KEPALA SEKOLAH STANDALONE PAGE
   ============================================================ */
function injectPrincipalStandaloneStyles() {

  if (
    document.getElementById(
      'principal-standalone-v206'
    )
  ) {
    return;
  }

  const style =
    document.createElement('style');

  style.id =
    'principal-standalone-v206';

  style.textContent = `
    /* Launcher kecil di Dashboard */
    .principal-teacher-dashboard-launcher {
      width: 100%;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 18px;
      margin: 18px 0;
      padding: 20px 22px;
      border: 1px solid #dbe4ef;
      border-radius: 16px;
      background: #ffffff;
      box-shadow: 0 10px 28px rgba(15, 23, 42, .08);
    }

    .principal-launcher-icon {
      width: 52px;
      height: 52px;
      flex: 0 0 52px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 14px;
      background: #eff6ff;
      font-size: 27px;
    }

    .principal-launcher-content {
      min-width: 0;
      flex: 1;
    }

    .principal-launcher-kicker {
      font-size: 11px;
      font-weight: 800;
      letter-spacing: .08em;
      color: #2563eb;
      margin-bottom: 4px;
    }

    .principal-launcher-title {
      font-size: 21px;
      font-weight: 800;
      color: #0f172a;
      line-height: 1.2;
    }

    .principal-launcher-subtitle {
      margin-top: 5px;
      font-size: 13px;
      color: #64748b;
    }

    .principal-launcher-button,
    .principal-standalone-primary-button {
      border: 0;
      border-radius: 11px;
      background: #2563eb;
      color: #ffffff;
      padding: 12px 17px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 7px 16px rgba(37, 99, 235, .22);
      white-space: nowrap;
    }

    .principal-launcher-button:hover,
    .principal-standalone-primary-button:hover {
      background: #1d4ed8;
    }

    /* Halaman standalone */
    .principal-teacher-standalone-page {
      display: none;
      position: relative;
      min-height: 100vh;
      box-sizing: border-box;
      background: #f4f7fb;
      color: #0f172a;
      z-index: 9998;
    }

    .principal-standalone-shell {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    .principal-standalone-header {
      position: sticky;
      top: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      padding: 18px 28px;
      background: #ffffff;
      border-bottom: 1px solid #dbe4ef;
      box-shadow: 0 4px 18px rgba(15, 23, 42, .06);
    }

    .principal-standalone-header-left {
      display: flex;
      align-items: center;
      gap: 18px;
      min-width: 0;
    }

    .principal-standalone-back-button {
      border: 1px solid #cbd5e1;
      background: #ffffff;
      color: #334155;
      border-radius: 10px;
      padding: 10px 14px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
    }

    .principal-standalone-back-button:hover {
      background: #f8fafc;
    }

    .principal-standalone-heading {
      min-width: 0;
    }

    .principal-standalone-kicker {
      font-size: 11px;
      font-weight: 800;
      letter-spacing: .09em;
      color: #2563eb;
      margin-bottom: 3px;
    }

    .principal-standalone-title {
      font-size: 25px;
      font-weight: 800;
      line-height: 1.2;
      color: #0f172a;
    }

    .principal-standalone-subtitle {
      margin-top: 4px;
      color: #64748b;
      font-size: 13px;
    }

    .principal-standalone-school {
      text-align: right;
      flex: 0 0 auto;
    }

    .principal-standalone-school-name {
      font-weight: 800;
      font-size: 13px;
      color: #0f766e;
    }

    .principal-standalone-school-meta {
      margin-top: 3px;
      font-size: 11px;
      color: #64748b;
    }

    .principal-standalone-content {
      width: min(1400px, calc(100% - 48px));
      margin: 24px auto 30px;
      box-sizing: border-box;
      flex: 1;
    }

    .principal-standalone-filter-card {
      background: #ffffff;
      border: 1px solid #dbe4ef;
      border-radius: 16px;
      padding: 20px;
      box-shadow: 0 10px 28px rgba(15, 23, 42, .07);
    }

    .principal-standalone-section-title {
      font-size: 17px;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 15px;
    }

    .principal-standalone-filter-grid {
      display: grid;
      grid-template-columns: minmax(200px, 1fr) minmax(200px, 1fr) auto;
      gap: 14px;
      align-items: end;
    }

    .principal-dashboard-field {
      display: flex;
      flex-direction: column;
      gap: 7px;
    }

    .principal-dashboard-field span {
      font-size: 12px;
      font-weight: 700;
      color: #475569;
    }

    .principal-dashboard-field input {
      width: 100%;
      min-height: 42px;
      box-sizing: border-box;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      padding: 9px 12px;
      background: #ffffff;
      color: #0f172a;
      font-size: 14px;
    }

    .principal-standalone-primary-button {
      min-height: 42px;
    }

    .principal-teacher-dashboard-message {
      min-height: 22px;
      margin-top: 12px;
      font-size: 13px;
      font-weight: 600;
    }

    .principal-teacher-dashboard-message.loading {
      color: #2563eb;
    }

    .principal-teacher-dashboard-message.success {
      color: #15803d;
    }

    .principal-teacher-dashboard-message.error {
      color: #dc2626;
    }

    .principal-standalone-result,
    .principal-standalone-detail {
      margin-top: 18px;
    }

    .principal-standalone-result > *,
    .principal-standalone-detail > * {
      max-width: 100%;
    }

    .principal-standalone-footer {
      margin-top: auto;
      padding: 22px 24px;
      text-align: center;
      background: #ffffff;
      border-top: 1px solid #dbe4ef;
    }

    .principal-standalone-footer-name {
      color: #0f766e;
      font-weight: 800;
      font-size: 13px;
    }

    .principal-standalone-footer-meta {
      margin-top: 5px;
      color: #64748b;
      font-size: 11px;
    }

    body.principal-teacher-standalone-mode {
      overflow-x: hidden;
    }

    body.principal-teacher-standalone-mode > *:not(#principalTeacherAttendancePage) {
      /* elemen aplikasi lama tetap ada, tetapi halaman standalone berada di atasnya */
    }

    @media (max-width: 900px) {

      .principal-teacher-dashboard-launcher {
        align-items: flex-start;
        flex-wrap: wrap;
      }

      .principal-launcher-content {
        flex-basis: calc(100% - 80px);
      }

      .principal-launcher-button {
        width: 100%;
      }

      .principal-standalone-header {
        align-items: flex-start;
        flex-direction: column;
        padding: 16px;
      }

      .principal-standalone-header-left {
        width: 100%;
        align-items: flex-start;
      }

      .principal-standalone-school {
        display: none;
      }

      .principal-standalone-content {
        width: calc(100% - 24px);
        margin-top: 14px;
      }

      .principal-standalone-filter-grid {
        grid-template-columns: 1fr;
      }

      .principal-standalone-primary-button {
        width: 100%;
      }

      .principal-standalone-title {
        font-size: 21px;
      }
    }

    @media (max-width: 600px) {

      .principal-teacher-dashboard-launcher {
        padding: 16px;
      }

      .principal-launcher-icon {
        width: 44px;
        height: 44px;
        flex-basis: 44px;
      }

      .principal-launcher-title {
        font-size: 18px;
      }

      .principal-launcher-subtitle {
        font-size: 12px;
      }

      .principal-standalone-header-left {
        gap: 10px;
      }

      .principal-standalone-back-button {
        padding: 9px 11px;
      }

      .principal-standalone-filter-card {
        padding: 15px;
      }
    }
  `;

  document.head.appendChild(style);
}

/* ============================================================
   45. INITIALIZE
============================================================ */

async function initializeApp() {

  console.log(
    '========================================'
  );


  console.log(
    'ABSENSI BAITUL ULUM'
  );


  console.log(
    'APP.JS FINAL V14'
  );


  console.log(
    'LOGIN: PASSWORD BIASA'
  );


  console.log(
    '========================================'
  );


  injectDashboardStyles();
  injectUnifiedUIStyles();
  injectPrincipalDashboardRefinementStyles();
  injectPrincipalStandaloneStyles();
  normalizeAppBrandingLayout();
  injectAppFooter();


  bindEvents();


  bindTeacherStudentEvents();


  updateAutoScanLabel();


  updateDateTime();


  setInterval(
    updateDateTime,
    1000
  );


  prepareSpeech();


  /*
   * Cek library scanner
   */

  if (
    typeof Html5Qrcode ===
    'undefined'
  ) {

    setStatus(
      '🔴 Library scanner belum siap. Silakan tunggu sebentar.'
    );

  } else {

    setStatus(
      '🟢 Scanner siap.'
    );
  }


  /*
   * Summary publik
   */

  await loadTodaySummary();


  /*
   * Restore session
   */

  await checkSession();


  /*
   * Daftar absensi publik hanya dimuat
   * jika dashboard tidak sedang tampil.
   */

  const dashboard = $('dashboard');
  const dashboardVisible =
    dashboard &&
    dashboard.style.display !== 'none';

  if (!dashboardVisible) {
    await loadTodayAttendance();
  }


  /*
   * Auto refresh
   */

  startAutoRefresh();

  updatePrincipalDashboardMode();
  setInterval(updatePrincipalDashboardMode, 800);


  console.log(
    'APP READY'
  );
}




/* ============================================================
   V20.7 - UNIFIED UI / BRANDING / PRINCIPAL LAYOUT
   ============================================================ */
function injectUnifiedUIStyles() {
  if (document.getElementById('unified-ui-v206')) return;

  const style = document.createElement('style');
  style.id = 'unified-ui-v206';
  style.textContent = `
    :root {
      --app-bg: #f3f6fa;
      --app-card: #ffffff;
      --app-text: #0f172a;
      --app-muted: #64748b;
      --app-border: #dbe3ec;
      --app-primary: #0f766e;
      --app-primary-2: #115e59;
      --app-blue: #2563eb;
      --app-radius: 18px;
      --app-shadow: 0 8px 28px rgba(15,23,42,.07);
    }

    html, body {
      min-height: 100%;
    }

    body {
      background: var(--app-bg) !important;
      color: var(--app-text);
    }

    /* Lebar utama dibuat konsisten, tetapi tetap responsif. */
    .container,
    .main-container,
    main {
      box-sizing: border-box !important;
      width: min(1180px, calc(100% - 32px)) !important;
      max-width: 1180px !important;
      margin-left: auto !important;
      margin-right: auto !important;
    }

    /* Branding sekolah selalu berada di tengah. */
    .app-brand-header-unified {
      text-align: center !important;
    }

    .app-brand-title-unified {
      display: block !important;
      width: 100% !important;
      text-align: center !important;
      margin-left: auto !important;
      margin-right: auto !important;
    }

    .app-brand-logo-unified {
      display: block !important;
      margin-left: auto !important;
      margin-right: auto !important;
      float: none !important;
    }

    /* Header utama: logo di atas, judul di tengah, info di bawah. */
    .app-brand-header-unified .app-brand-logo-unified {
      margin-bottom: 8px !important;
    }

    /* Dashboard Kepala Sekolah tidak lagi menempel sebagai kartu hijau sempit. */
    body.principal-dashboard-mode #dashboard {
      width: 100% !important;
      max-width: 1180px !important;
      margin: 18px auto 28px !important;
      padding: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      border: 0 !important;
    }

    body.principal-dashboard-mode #dashboard > * {
      box-sizing: border-box !important;
      max-width: 100% !important;
    }

    body.principal-dashboard-mode .principal-teacher-dashboard-panel {
      width: 100% !important;
      max-width: none !important;
      margin: 0 !important;
      padding: 24px !important;
      border: 1px solid var(--app-border) !important;
      border-radius: var(--app-radius) !important;
      background: var(--app-card) !important;
      box-shadow: var(--app-shadow) !important;
    }

    body.principal-dashboard-mode .principal-dashboard-header {
      display: block !important;
      padding-bottom: 16px !important;
      border-bottom: 1px solid #edf2f7 !important;
    }

    body.principal-dashboard-mode .principal-dashboard-title {
      font-size: 23px !important;
      line-height: 1.25 !important;
    }

    body.principal-dashboard-mode .principal-dashboard-subtitle {
      max-width: 900px !important;
      font-size: 12px !important;
    }

    body.principal-dashboard-mode .principal-dashboard-controls {
      grid-template-columns: minmax(190px, 1fr) minmax(190px, 1fr) auto !important;
      gap: 12px !important;
      padding: 16px 0 4px !important;
    }

    body.principal-dashboard-mode .principal-summary-grid,
    body.principal-dashboard-mode .principal-detail-summary-grid {
      grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)) !important;
      gap: 10px !important;
    }

    body.principal-dashboard-mode .principal-summary-card,
    body.principal-dashboard-mode .principal-detail-stat {
      min-width: 0 !important;
      border-radius: 14px !important;
    }

    body.principal-dashboard-mode .principal-table-wrap,
    body.principal-dashboard-mode .principal-detail-table-wrap {
      width: 100% !important;
      max-width: 100% !important;
      overflow-x: auto !important;
      border-radius: 14px !important;
    }

    /* Semua kartu dashboard memiliki bahasa visual yang sama. */
    #dashboard .dashboard-section,
    #dashboard .dashboard-card,
    #dashboard .card,
    #dashboard .panel,
    #dashboard .section-card,
    #dashboard .teacher-attendance-panel,
    #dashboard .teacher-recap-panel,
    #dashboard .admin-recap-panel,
    #dashboard .principal-teacher-dashboard-panel {
      border-radius: var(--app-radius) !important;
      border-color: var(--app-border) !important;
      box-shadow: var(--app-shadow) !important;
    }

    /* Login modal dibuat satu keluarga dengan dashboard. */
    #loginModal,
    .login-modal,
    .modal[role="dialog"] {
      border-radius: 18px !important;
    }

    #loginModal .modal-content,
    .login-modal .modal-content,
    .modal[role="dialog"] .modal-content {
      border-radius: 18px !important;
      border: 1px solid var(--app-border) !important;
      box-shadow: 0 18px 50px rgba(15,23,42,.18) !important;
      background: #fff !important;
    }

    /* Input dan tombol konsisten di seluruh aplikasi. */
    #dashboard input,
    #dashboard select,
    #dashboard textarea,
    #loginModal input,
    .login-modal input {
      border-radius: 10px !important;
      border-color: #cbd5e1 !important;
      box-sizing: border-box !important;
    }

    #dashboard button,
    #loginModal button,
    .login-modal button {
      border-radius: 10px;
    }

    /* Kepala Sekolah tidak menampilkan Jadwal Mengajar Hari Ini. */
    body.principal-dashboard-mode #teacherSchedulePanel,
    body.principal-dashboard-mode #teacherSchedulesPanel,
    body.principal-dashboard-mode #jadwalMengajarHariIni,
    body.principal-dashboard-mode [data-section="teacher-schedule-today"] {
      display: none !important;
    }

    /* Jika panel jadwal tidak memiliki ID, sembunyikan berdasarkan judul. */
    body.principal-dashboard-mode .dashboard-section.principal-hide-today-schedule,
    body.principal-dashboard-mode .card.principal-hide-today-schedule,
    body.principal-dashboard-mode .panel.principal-hide-today-schedule {
      display: none !important;
    }

    @media (max-width: 900px) {
      .container,
      .main-container,
      main {
        width: calc(100% - 24px) !important;
      }

      body.principal-dashboard-mode .principal-dashboard-controls {
        grid-template-columns: 1fr !important;
      }

      body.principal-dashboard-mode .principal-dashboard-button {
        width: 100% !important;
      }
    }

    @media (max-width: 600px) {
      .container,
      .main-container,
      main {
        width: calc(100% - 16px) !important;
      }

      body.principal-dashboard-mode .principal-teacher-dashboard-panel {
        padding: 15px !important;
        border-radius: 14px !important;
      }
    }
  `;

  document.head.appendChild(style);
}

function normalizeAppBrandingLayout() {
  const appName = 'ABSENSI KARTU PELAJAR';
  const elements = Array.from(document.querySelectorAll('body *'));

  const title = elements.find(function(el) {
    if (!el || el.children.length > 3) return false;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim().toUpperCase();
    return text === appName;
  });

  if (!title) return;

  title.classList.add('app-brand-title-unified');

  let root = title.closest('header, .header, .app-header, .site-header, .hero, .top-header');
  if (!root) {
    root = title.parentElement;
    for (let i = 0; i < 2 && root && root.parentElement; i++) {
      if (root.querySelector('img')) break;
      root = root.parentElement;
    }
  }

  if (!root) return;

  root.classList.add('app-brand-header-unified');

  const images = Array.from(root.querySelectorAll('img'));
  if (images.length) {
    images[0].classList.add('app-brand-logo-unified');
  }
}

function markPrincipalTodaySchedulePanels() {
  if (!currentUser) return;

  const role = String(currentUser.role || '').trim().toUpperCase();
  const isPrincipal = role === 'KEPALA_SEKOLAH';
  document.body.classList.toggle('principal-dashboard-mode', isPrincipal);

  if (!isPrincipal) return;

  document.querySelectorAll('section, .card, .panel, .dashboard-card, .dashboard-section').forEach(function(el) {
    if (!el || el.id === 'dashboard') return;

    const text = (el.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (
      text.startsWith('📚 jadwal mengajar hari ini') ||
      text.startsWith('jadwal mengajar hari ini') ||
      text.includes('jadwal mengajar hari ini') && text.length < 500
    ) {
      el.classList.add('principal-hide-today-schedule');
      el.style.display = 'none';
    }
  });
}

/* ============================================================
   V20.4 - DASHBOARD KEPALA SEKOLAH UI REFINEMENT
   ============================================================ */
function injectPrincipalDashboardRefinementStyles() {
  if (document.getElementById('principal-dashboard-refinement-v204')) return;

  const style = document.createElement('style');
  style.id = 'principal-dashboard-refinement-v204';
  style.textContent = `
    /* Saat dashboard kepala sekolah tampil, gunakan lebar layar yang lebih lega */
    body.principal-dashboard-mode .container,
    body.principal-dashboard-mode main,
    body.principal-dashboard-mode .main-container {
      max-width: 1400px !important;
      width: calc(100% - 32px) !important;
    }

    body.principal-dashboard-mode #dashboard {
      width: 100% !important;
      max-width: 1400px !important;
      margin: 18px auto 30px !important;
    }

    body.principal-dashboard-mode #dashboard > * {
      max-width: 100% !important;
    }

    /* Panel utama Kepala Sekolah */
    body.principal-dashboard-mode .principal-dashboard-panel,
    body.principal-dashboard-mode #principalTeacherAttendancePanel,
    body.principal-dashboard-mode [id*="principalTeacherAttendance"] {
      width: 100% !important;
      max-width: none !important;
      box-sizing: border-box;
    }

    /* Kartu ringkasan */
    body.principal-dashboard-mode .principal-summary-grid,
    body.principal-dashboard-mode .summary-grid {
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)) !important;
      width: 100% !important;
    }

    /* Tabel monitoring guru */
    body.principal-dashboard-mode .principal-teacher-table-wrap,
    body.principal-dashboard-mode .teacher-attendance-table-wrap {
      width: 100% !important;
      overflow-x: auto !important;
      border-radius: 14px !important;
    }

    body.principal-dashboard-mode .principal-teacher-table,
    body.principal-dashboard-mode table {
      width: 100% !important;
    }

    /* Filter tanggal dibuat lebih seimbang */
    body.principal-dashboard-mode .principal-filter-grid {
      display: grid !important;
      grid-template-columns: minmax(190px, 1fr) minmax(190px, 1fr) auto !important;
      gap: 14px !important;
      align-items: end !important;
    }

    @media (max-width: 900px) {
      body.principal-dashboard-mode .principal-filter-grid {
        grid-template-columns: 1fr !important;
      }
    }

    /* Hilangkan area Jadwal Mengajar Hari Ini saat Kepala Sekolah login */
    body.principal-dashboard-mode #teacherSchedulePanel,
    body.principal-dashboard-mode #teacherSchedulesPanel,
    body.principal-dashboard-mode #jadwalMengajarHariIni,
    body.principal-dashboard-mode [data-section="teacher-schedule-today"] {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
}



/* ============================================================
   V20.4 - PRINCIPAL DASHBOARD MODE
   ============================================================ */
function updatePrincipalDashboardMode() {
  const dashboard = document.getElementById('dashboard');
  if (!dashboard) return;

  const textContent = (dashboard.innerText || '').toUpperCase();
  const isPrincipal =
    textContent.includes('DASHBOARD KEPALA SEKOLAH') ||
    textContent.includes('KEPALA SEKOLAH');

  document.body.classList.toggle('principal-dashboard-mode', isPrincipal);
  markPrincipalTodaySchedulePanels();
  normalizeAppBrandingLayout();

  /* Jangan tampilkan panel jadwal guru hari ini di dashboard Kepala Sekolah */
  if (isPrincipal) {
    const candidates = [
      'teacherSchedulePanel',
      'teacherSchedulesPanel',
      'jadwalMengajarHariIni'
    ];

    candidates.forEach(function(id) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });

    document.querySelectorAll('section, .card, .panel, .dashboard-card').forEach(function(el) {
      const t = (el.innerText || '').trim().toLowerCase();
      if (
        t.startsWith('📚 jadwal mengajar hari ini') ||
        t.startsWith('jadwal mengajar hari ini')
      ) {
        el.style.display = 'none';
      }
    });
  }
}


/* ============================================================
   46. WINDOW LOAD
============================================================ */

window.addEventListener(
  'load',
  function () {

    initializeApp();

  }
);


/* ============================================================
   47. PUBLIC FUNCTIONS
============================================================ */

window.startScanner =
  startScanner;

window.stopScanner =
  stopScanner;

window.restartScanner =
  restartScanner;

window.openLoginModal =
  openLoginModal;

window.closeLoginModal =
  closeLoginModal;

window.loginUser =
  loginUser;

window.logoutUser =
  logoutUser;

window.selectTeacherSchedule =
  selectTeacherSchedule;

window.handleTeacherCheckIn =
  handleTeacherCheckIn;

window.loadPrincipalTeacherAttendance =
  loadPrincipalTeacherAttendance;

window.loadPrincipalTeacherDetail =
  loadPrincipalTeacherDetail;

window.showAllAttendance =
  showAllAttendance;

window.loadWACenterDashboard =
  loadWACenterDashboard;

window.sendManualWAMessageFromDashboard =
  sendManualWAMessageFromDashboard;

window.loadWAHistory =
  loadWAHistory;

window.resendWAFromDashboard =
  resendWAFromDashboard;

window.rebuildMonthlyRecapFromDashboard =
  rebuildMonthlyRecapFromDashboard;

window.loadTeacherMonthlyRecap =
  loadTeacherMonthlyRecap;

window.downloadTeacherMonthlyRecapXlsx =
  downloadTeacherMonthlyRecapXlsx;

window.downloadAdminMonthlyRecapXlsx =
  downloadAdminMonthlyRecapXlsx;

window.loadTeacherRecapOptions =
  loadTeacherRecapOptions;


/* ============================================================
   END APP.JS V20.7 - UNIFIED UI + DASHBOARD KEPALA SEKOLAH + PRESENSI GURU + WHATSAPP CENTER
============================================================ */


/* ========================================================================
 * V23 - INTEGRASI REKAP GURU BULANAN + EXPORT EXCEL/PDF
 * ------------------------------------------------------------------------
 * ADDITIVE ONLY:
 * - Tidak mengubah index.html
 * - Tidak mengubah style.css
 * - Tidak menghapus/mengganti fungsi app.js existing
 * - Menambahkan panel pada halaman Monitoring Kepala Sekolah
 *
 * Backend yang digunakan:
 *   action: principalTeacherMonthlyRecap
 *   action: exportPrincipalTeacherRecap
 * ======================================================================== */

(function() {
  'use strict';

  const V23_STYLE_ID = 'v23-rekap-guru-monitoring-style';
  const V23_PANEL_ID = 'v23RekapGuruMonthlyPanel';
  let v23ObserverStarted = false;
  let v23Loading = false;
  let v23State = {
    bulan: '',
    tahun: '',
    guruId: '',
    rows: [],
    summary: null
  };

  function v23Esc(value) {
    if (typeof escapeHTML === 'function') {
      return escapeHTML(String(value == null ? '' : value));
    }
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function v23MonthName(month) {
    const names = [
      '', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    return names[Number(month)] || String(month || '');
  }

  function v23TodayPeriod() {
    const now = new Date();
    return {
      bulan: String(now.getMonth() + 1),
      tahun: String(now.getFullYear())
    };
  }

  function v23EnsureStyle() {
    if (document.getElementById(V23_STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = V23_STYLE_ID;
    style.textContent = `
      #${V23_PANEL_ID} {
        margin: 18px 0 0;
        padding: 18px;
        border: 1px solid #dbe3ec;
        border-radius: 18px;
        background: #ffffff;
        box-shadow: 0 7px 24px rgba(15, 23, 42, .06);
      }

      #${V23_PANEL_ID} .v23-title-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 14px;
        flex-wrap: wrap;
      }

      #${V23_PANEL_ID} .v23-kicker {
        color: #2563eb;
        font-size: 11px;
        font-weight: 900;
        letter-spacing: .08em;
        text-transform: uppercase;
      }

      #${V23_PANEL_ID} .v23-title {
        margin-top: 3px;
        font-size: 19px;
        font-weight: 900;
        color: #0f172a;
      }

      #${V23_PANEL_ID} .v23-subtitle {
        margin-top: 4px;
        color: #64748b;
        font-size: 12px;
        line-height: 1.5;
      }

      #${V23_PANEL_ID} .v23-controls {
        display: grid;
        grid-template-columns: 150px 120px minmax(220px, 1fr) auto;
        gap: 10px;
        align-items: end;
        margin-top: 15px;
      }

      #${V23_PANEL_ID} .v23-field span {
        display: block;
        margin-bottom: 5px;
        font-size: 12px;
        font-weight: 800;
        color: #475569;
      }

      #${V23_PANEL_ID} .v23-field select {
        width: 100%;
        box-sizing: border-box;
        padding: 9px 10px;
        border: 1px solid #cbd5e1;
        border-radius: 9px;
        background: #fff;
        color: #0f172a;
      }

      #${V23_PANEL_ID} .v23-load-button,
      #${V23_PANEL_ID} .v23-export-button {
        border: 0;
        border-radius: 9px;
        padding: 10px 14px;
        font-weight: 800;
        cursor: pointer;
        white-space: nowrap;
      }

      #${V23_PANEL_ID} .v23-load-button {
        background: #2563eb;
        color: #fff;
      }

      #${V23_PANEL_ID} .v23-export-row {
        display: flex;
        align-items: center;
        gap: 9px;
        flex-wrap: wrap;
        margin-top: 13px;
        padding: 11px 12px;
        border: 1px solid #dcfce7;
        border-radius: 12px;
        background: #f0fdf4;
      }

      #${V23_PANEL_ID} .v23-export-button.excel {
        background: #15803d;
        color: #fff;
      }

      #${V23_PANEL_ID} .v23-export-button.pdf {
        background: #b91c1c;
        color: #fff;
      }

      #${V23_PANEL_ID} .v23-export-button.download {
        background: #0369a1;
        color: #fff;
      }

      #${V23_PANEL_ID} .v23-export-button.download:hover {
        filter: brightness(.95);
      }

      #${V23_PANEL_ID} button:disabled {
        opacity: .6;
        cursor: wait;
      }

      #${V23_PANEL_ID} .v23-message {
        margin-top: 10px;
        min-height: 18px;
        font-size: 12px;
        line-height: 1.5;
      }

      #${V23_PANEL_ID} .v23-message.loading { color: #92400e; }
      #${V23_PANEL_ID} .v23-message.success { color: #166534; }
      #${V23_PANEL_ID} .v23-message.error { color: #b91c1c; }

      #${V23_PANEL_ID} .v23-summary {
        display: grid;
        grid-template-columns: repeat(7, minmax(90px, 1fr));
        gap: 9px;
        margin-top: 15px;
      }

      #${V23_PANEL_ID} .v23-stat {
        padding: 10px;
        border: 1px solid #e2e8f0;
        border-radius: 11px;
        background: #f8fafc;
        text-align: center;
      }

      #${V23_PANEL_ID} .v23-stat span {
        display: block;
        color: #64748b;
        font-size: 11px;
      }

      #${V23_PANEL_ID} .v23-stat strong {
        display: block;
        margin-top: 3px;
        color: #0f172a;
        font-size: 18px;
      }

      #${V23_PANEL_ID} .v23-table-wrap {
        width: 100%;
        overflow-x: auto;
        margin-top: 14px;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
      }

      #${V23_PANEL_ID} table {
        width: 100%;
        min-width: 980px;
        border-collapse: collapse;
      }

      #${V23_PANEL_ID} th,
      #${V23_PANEL_ID} td {
        padding: 9px 10px;
        border-bottom: 1px solid #e2e8f0;
        text-align: center;
        vertical-align: middle;
        font-size: 12px;
      }

      #${V23_PANEL_ID} th {
        background: #f8fafc;
        color: #334155;
        font-weight: 900;
      }

      #${V23_PANEL_ID} td:nth-child(2),
      #${V23_PANEL_ID} td:nth-child(5) {
        text-align: left;
      }

      #${V23_PANEL_ID} tr:last-child td {
        border-bottom: 0;
      }

      #${V23_PANEL_ID} .v23-guru-name {
        font-weight: 800;
        color: #0f172a;
      }

      #${V23_PANEL_ID} .v23-guru-id {
        margin-top: 2px;
        color: #64748b;
        font-size: 10px;
      }

      #${V23_PANEL_ID} .v23-percent {
        display: inline-block;
        padding: 4px 8px;
        border-radius: 999px;
        font-weight: 900;
      }

      #${V23_PANEL_ID} .v23-percent.good {
        background: #dcfce7;
        color: #166534;
      }

      #${V23_PANEL_ID} .v23-percent.warning {
        background: #fef3c7;
        color: #92400e;
      }

      #${V23_PANEL_ID} .v23-percent.danger {
        background: #fee2e2;
        color: #991b1b;
      }

      #${V23_PANEL_ID} .v23-empty {
        margin-top: 14px;
        padding: 18px;
        border-radius: 12px;
        background: #f8fafc;
        color: #64748b;
        text-align: center;
      }

      @media (max-width: 900px) {
        #${V23_PANEL_ID} .v23-controls {
          grid-template-columns: 1fr 1fr;
        }

        #${V23_PANEL_ID} .v23-controls .v23-field:nth-child(3),
        #${V23_PANEL_ID} .v23-controls .v23-load-button {
          grid-column: 1 / -1;
        }

        #${V23_PANEL_ID} .v23-summary {
          grid-template-columns: repeat(3, 1fr);
        }
      }

      @media (max-width: 600px) {
        #${V23_PANEL_ID} {
          padding: 13px;
          border-radius: 14px;
        }

        #${V23_PANEL_ID} .v23-controls {
          grid-template-columns: 1fr;
        }

        #${V23_PANEL_ID} .v23-controls .v23-field:nth-child(3),
        #${V23_PANEL_ID} .v23-controls .v23-load-button {
          grid-column: auto;
        }

        #${V23_PANEL_ID} .v23-summary {
          grid-template-columns: repeat(2, 1fr);
        }
      }
    `;

    document.head.appendChild(style);
  }

  function v23PanelHTML() {
    const period = v23TodayPeriod();

    return `
      <section id="${V23_PANEL_ID}">
        <div class="v23-title-row">
          <div>
            <div class="v23-kicker">REKAP BULANAN & EXPORT</div>
            <div class="v23-title">📊 Rekap Presensi Guru Bulanan</div>
            <div class="v23-subtitle">
              Data diambil dari REKAP_GURU_BULANAN. Pilih periode dan guru untuk melihat rekap, lalu export ke Excel atau PDF.
            </div>
          </div>
        </div>

        <div class="v23-controls">
          <label class="v23-field">
            <span>Bulan</span>
            <select id="v23RekapBulan">
              ${Array.from({length: 12}, function(_, i) {
                const month = i + 1;
                return '<option value="' + month + '"' +
                  (String(month) === period.bulan ? ' selected' : '') + '>' +
                  v23Esc(v23MonthName(month)) +
                  '</option>';
              }).join('')}
            </select>
          </label>

          <label class="v23-field">
            <span>Tahun</span>
            <select id="v23RekapTahun">
              <option value="2026">2026</option>
              <option value="2027">2027</option>
              <option value="2028">2028</option>
            </select>
          </label>

          <label class="v23-field">
            <span>Guru</span>
            <select id="v23RekapGuruSelect">
              <option value="">Semua Guru</option>
            </select>
          </label>

          <button type="button" id="v23RekapLoadButton" class="v23-load-button">
            🔄 Tampilkan Rekap
          </button>
        </div>

        <div class="v23-export-row">
          <strong style="font-size:12px;color:#166534;">Export:</strong>
          <button type="button" id="v23ExportXlsxButton" class="v23-export-button excel">
            📗 Excel (.xlsx)
          </button>
          <button type="button" id="v23ExportPdfButton" class="v23-export-button pdf">
            📕 PDF
          </button>
          <button type="button" id="v23DownloadXlsxButton" class="v23-export-button download">
            ⬇️ Download Excel
          </button>
          <button type="button" id="v23DownloadPdfButton" class="v23-export-button download">
            ⬇️ Download PDF
          </button>
          <span id="v23ExportMessage" class="v23-message"></span>
        </div>

        <div id="v23RekapMessage" class="v23-message"></div>
        <div id="v23RekapSummary"></div>
        <div id="v23RekapResult"></div>
      </section>
    `;
  }

  function v23SetMessage(message, type) {
    const el = document.getElementById('v23RekapMessage');
    if (!el) return;
    el.className = 'v23-message ' + (type || '');
    el.textContent = message || '';
  }

  function v23SetExportMessage(message, type) {
    const el = document.getElementById('v23ExportMessage');
    if (!el) return;
    el.className = 'v23-message ' + (type || '');
    el.textContent = message || '';
  }

  function v23PopulateGuruOptions(rows, selectedGuruId) {
    const select = document.getElementById('v23RekapGuruSelect');
    if (!select) return;

    const current = String(selectedGuruId || select.value || '');
    const unique = {};

    (Array.isArray(rows) ? rows : []).forEach(function(row) {
      const id = String(row.guruId || '').trim();
      const name = String(row.namaGuru || 'Guru').trim();
      if (id) unique[id] = name;
    });

    const options = Object.keys(unique)
      .sort(function(a, b) {
        return unique[a].localeCompare(unique[b], 'id');
      })
      .map(function(id) {
        return '<option value="' + v23Esc(id) + '"' +
          (id === current ? ' selected' : '') + '>' +
          v23Esc(unique[id]) + ' (' + v23Esc(id) + ')' +
          '</option>';
      })
      .join('');

    select.innerHTML = '<option value="">Semua Guru</option>' + options;

    if (current && unique[current]) {
      select.value = current;
    } else {
      select.value = '';
    }
  }

  function v23RenderSummary(summary) {
    summary = summary || {};
    return `
      <div class="v23-summary">
        <div class="v23-stat"><span>Total Guru</span><strong>${Number(summary.totalGuru || 0)}</strong></div>
        <div class="v23-stat"><span>Total Jadwal</span><strong>${Number(summary.totalJadwal || 0)}</strong></div>
        <div class="v23-stat"><span>Hadir</span><strong>${Number(summary.hadir || 0)}</strong></div>
        <div class="v23-stat"><span>Terlambat</span><strong>${Number(summary.terlambat || 0)}</strong></div>
        <div class="v23-stat"><span>Izin</span><strong>${Number(summary.izin || 0)}</strong></div>
        <div class="v23-stat"><span>Sakit</span><strong>${Number(summary.sakit || 0)}</strong></div>
        <div class="v23-stat"><span>Alpa</span><strong>${Number(summary.alpa || 0)}</strong></div>
      </div>
    `;
  }

  function v23RenderTable(rows) {
    rows = Array.isArray(rows) ? rows : [];

    if (!rows.length) {
      return `
        <div class="v23-empty">
          📭 Tidak ada data rekap guru untuk periode/filter yang dipilih.
        </div>
      `;
    }

    const body = rows.map(function(row, index) {
      const percentage = Number(row.persentase || 0);
      const cls = percentage >= 90 ? 'good' : percentage >= 75 ? 'warning' : 'danger';

      return `
        <tr>
          <td>${index + 1}</td>
          <td>
            <div class="v23-guru-name">${v23Esc(row.namaGuru || '')}</div>
            <div class="v23-guru-id">${v23Esc(row.guruId || '')}</div>
          </td>
          <td>${Number(row.totalJadwal || 0)}</td>
          <td>${Number(row.hadir || 0)}</td>
          <td>${Number(row.terlambat || 0)}</td>
          <td>${Number(row.izin || 0)}</td>
          <td>${Number(row.sakit || 0)}</td>
          <td>${Number(row.alpa || 0)}</td>
          <td>${Number(row.belumAbsen || 0)}</td>
          <td>
            <span class="v23-percent ${cls}">${percentage.toFixed(2)}%</span>
          </td>
          <td>${v23Esc(row.terakhirUpdate || '-')}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="v23-table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Guru</th>
              <th>Jadwal</th>
              <th>Hadir</th>
              <th>Terlambat</th>
              <th>Izin</th>
              <th>Sakit</th>
              <th>Alpa</th>
              <th>Belum Absen</th>
              <th>Persentase</th>
              <th>Update</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    `;
  }

  async function v23LoadRecap() {
    if (v23Loading) return;

    const role = String(currentUser?.role || '').toUpperCase();
    if (!currentToken || role !== 'KEPALA_SEKOLAH') {
      v23SetMessage('⛔ Rekap bulanan hanya dapat diakses Kepala Sekolah.', 'error');
      return;
    }

    const bulan = String(document.getElementById('v23RekapBulan')?.value || '').trim();
    const tahun = String(document.getElementById('v23RekapTahun')?.value || '').trim();
    const guruId = String(document.getElementById('v23RekapGuruSelect')?.value || '').trim();

    if (!bulan || !tahun) {
      v23SetMessage('⚠️ Bulan dan tahun wajib dipilih.', 'error');
      return;
    }

    const button = document.getElementById('v23RekapLoadButton');
    if (button) {
      button.disabled = true;
      button.textContent = '⏳ Memuat...';
    }

    v23Loading = true;
    v23SetMessage('⏳ Mengambil rekap guru bulanan...', 'loading');

    try {
      const result = await apiGet({
        action: 'principalTeacherMonthlyRecap',
        token: currentToken,
        bulan: bulan,
        tahun: tahun,
        guruId: guruId
      }, { timeoutMs: 120000 });

      if (result?.status === 'SESSION_EXPIRED') {
        if (typeof handleSessionExpired === 'function') {
          handleSessionExpired();
        }
        return;
      }

      if (!result || !result.success) {
        throw new Error(result?.message || 'Rekap guru gagal dimuat.');
      }

      v23State = {
        bulan: String(result.bulan || bulan),
        tahun: String(result.tahun || tahun),
        guruId: guruId,
        rows: Array.isArray(result.rows) ? result.rows : [],
        summary: result.summary || {}
      };

      if (!guruId) {
        v23PopulateGuruOptions(v23State.rows, '');
      }

      const summary = document.getElementById('v23RekapSummary');
      const resultBox = document.getElementById('v23RekapResult');

      if (summary) {
        summary.innerHTML = v23RenderSummary(v23State.summary);
      }

      if (resultBox) {
        resultBox.innerHTML =
          '<div style="margin-top:13px;font-size:13px;font-weight:800;color:#334155;">' +
          'Periode: ' + v23Esc(v23MonthName(Number(v23State.bulan))) + ' ' +
          v23Esc(v23State.tahun) +
          (guruId ? ' | Guru: ' + v23Esc(guruId) : ' | Semua Guru') +
          '</div>' +
          v23RenderTable(v23State.rows);
      }

      v23SetMessage(
        '✅ Rekap ' + v23MonthName(Number(v23State.bulan)) + ' ' + v23State.tahun + ' berhasil dimuat.',
        'success'
      );

    } catch (error) {
      console.error('V23 REKAP GURU ERROR:', error);
      v23SetMessage('❌ ' + (error?.message || 'Gagal mengambil rekap guru.'), 'error');
    } finally {
      v23Loading = false;
      if (button) {
        button.disabled = false;
        button.textContent = '🔄 Tampilkan Rekap';
      }
    }
  }

  async function v23Export(format) {
    const role = String(currentUser?.role || '').toUpperCase();
    if (!currentToken || role !== 'KEPALA_SEKOLAH') {
      v23SetExportMessage('⛔ Hanya Kepala Sekolah.', 'error');
      return;
    }

    const bulan = String(document.getElementById('v23RekapBulan')?.value || v23State.bulan || '').trim();
    const tahun = String(document.getElementById('v23RekapTahun')?.value || v23State.tahun || '').trim();
    const guruId = String(document.getElementById('v23RekapGuruSelect')?.value || '').trim();

    if (!bulan || !tahun) {
      v23SetExportMessage('⚠️ Pilih bulan dan tahun terlebih dahulu.', 'error');
      return;
    }

    const xlsxButton = document.getElementById('v23ExportXlsxButton');
    const pdfButton = document.getElementById('v23ExportPdfButton');

    [xlsxButton, pdfButton].forEach(function(button) {
      if (button) button.disabled = true;
    });

    v23SetExportMessage(
      '⏳ Menyiapkan file ' + (format === 'pdf' ? 'PDF' : 'Excel') + '...',
      'loading'
    );

    try {
      const result = await apiGet({
        action: 'exportPrincipalTeacherRecap',
        token: currentToken,
        bulan: bulan,
        tahun: tahun,
        format: format,
        guruId: guruId
      }, { timeoutMs: 120000 });

      if (result?.status === 'SESSION_EXPIRED') {
        if (typeof handleSessionExpired === 'function') {
          handleSessionExpired();
        }
        return;
      }

      if (!result || !result.success) {
        throw new Error(result?.message || 'Export gagal.');
      }

      const url = result.downloadUrl || result.fileUrl || '';
      if (!url) {
        throw new Error('File berhasil dibuat tetapi URL file tidak tersedia.');
      }

      v23SetExportMessage(
        '✅ ' + result.fileName + ' berhasil dibuat. Membuka file...',
        'success'
      );

      window.open(url, '_blank', 'noopener,noreferrer');

    } catch (error) {
      console.error('V23 EXPORT REKAP GURU ERROR:', error);
      v23SetExportMessage('❌ ' + (error?.message || 'Export gagal.'), 'error');
    } finally {
      [xlsxButton, pdfButton].forEach(function(button) {
        if (button) button.disabled = false;
      });
    }
  }

  async function v23DownloadToDevice(format) {
    const bulan = String(document.getElementById('v23RekapBulan')?.value || '').trim();
    const tahun = String(document.getElementById('v23RekapTahun')?.value || '').trim();
    const guruId = String(document.getElementById('v23RekapGuruSelect')?.value || '').trim();

    if (!bulan || !tahun) {
      v23SetExportMessage('⚠️ Pilih bulan dan tahun terlebih dahulu.', 'error');
      return;
    }

    const xlsxButton = document.getElementById('v23DownloadXlsxButton');
    const pdfButton = document.getElementById('v23DownloadPdfButton');
    [xlsxButton, pdfButton].forEach(function(button) {
      if (button) button.disabled = true;
    });

    const label = format === 'pdf' ? 'PDF' : 'Excel';
    v23SetExportMessage('⏳ Menyiapkan ' + label + ' untuk diunduh...', 'loading');

    try {
      const result = await apiGet({
        action: 'exportPrincipalTeacherRecap',
        token: currentToken,
        bulan: bulan,
        tahun: tahun,
        format: format,
        guruId: guruId
      }, { timeoutMs: 120000 });

      if (result?.status === 'SESSION_EXPIRED') {
        if (typeof handleSessionExpired === 'function') handleSessionExpired();
        return;
      }

      if (!result || !result.success) {
        throw new Error(result?.message || 'Download gagal.');
      }

      const url = result.downloadUrl || '';
      if (!url) throw new Error('URL download tidak tersedia.');

      // Backend menyediakan downloadUrl Google Drive dengan export=download.
      // Anchor download membantu browser PC/HP memulai proses unduh.
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.fileName || ('Rekap_Presensi_Guru.' + (format === 'pdf' ? 'pdf' : 'xlsx'));
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      setTimeout(function() {
        try { anchor.remove(); } catch (_) {}
      }, 1500);

      v23SetExportMessage(
        '⬇️ ' + (result.fileName || label) + ' sedang diunduh. Jika browser meminta izin, pilih Simpan/Download.',
        'success'
      );
    } catch (error) {
      console.error('V24 DOWNLOAD REKAP GURU ERROR:', error);
      v23SetExportMessage('❌ ' + (error?.message || 'Download gagal.'), 'error');
    } finally {
      [xlsxButton, pdfButton].forEach(function(button) {
        if (button) button.disabled = false;
      });
    }
  }

  function v23BindEvents() {
    const loadButton = document.getElementById('v23RekapLoadButton');
    const xlsxButton = document.getElementById('v23ExportXlsxButton');
    const pdfButton = document.getElementById('v23ExportPdfButton');
    const downloadXlsxButton = document.getElementById('v23DownloadXlsxButton');
    const downloadPdfButton = document.getElementById('v23DownloadPdfButton');
    const month = document.getElementById('v23RekapBulan');
    const year = document.getElementById('v23RekapTahun');
    const guru = document.getElementById('v23RekapGuruSelect');

    if (year) {
      const allowedYears = ['2026', '2027', '2028'];
      if (!allowedYears.includes(String(year.value))) {
        year.value = '2026';
      }
    }

    if (loadButton && !loadButton.dataset.boundV23) {
      loadButton.dataset.boundV23 = '1';
      loadButton.addEventListener('click', v23LoadRecap);
    }

    if (xlsxButton && !xlsxButton.dataset.boundV23) {
      xlsxButton.dataset.boundV23 = '1';
      xlsxButton.addEventListener('click', function() { v23Export('xlsx'); });
    }

    if (pdfButton && !pdfButton.dataset.boundV23) {
      pdfButton.dataset.boundV23 = '1';
      pdfButton.addEventListener('click', function() { v23Export('pdf'); });
    }

    if (downloadXlsxButton && !downloadXlsxButton.dataset.boundV24) {
      downloadXlsxButton.dataset.boundV24 = '1';
      downloadXlsxButton.addEventListener('click', function() { v23DownloadToDevice('xlsx'); });
    }

    if (downloadPdfButton && !downloadPdfButton.dataset.boundV24) {
      downloadPdfButton.dataset.boundV24 = '1';
      downloadPdfButton.addEventListener('click', function() { v23DownloadToDevice('pdf'); });
    }

    [month, year, guru].forEach(function(el) {
      if (!el || el.dataset.boundV23Change) return;
      el.dataset.boundV23Change = '1';
      el.addEventListener('change', function() {
        v23SetExportMessage('', '');
      });
    });
  }

  function v23InjectPanel() {
    const page = document.getElementById('principalTeacherAttendancePage');
    if (!page) return false;
    if (document.getElementById(V23_PANEL_ID)) return true;

    const detail = document.getElementById('principalTeacherDetailResult');
    const panel = document.createElement('div');
    panel.innerHTML = v23PanelHTML();
    const section = panel.firstElementChild;
    if (!section) return false;

    if (detail && detail.parentNode) {
      detail.parentNode.insertBefore(section, detail.nextSibling);
    } else {
      const content = page.querySelector('.principal-standalone-content');
      if (content) content.appendChild(section);
      else page.appendChild(section);
    }

    v23EnsureStyle();
    v23BindEvents();
    return true;
  }

  function v23StartObserver() {
    if (v23ObserverStarted) return;
    v23ObserverStarted = true;

    v23EnsureStyle();

    const tryInject = function() {
      if (v23InjectPanel()) return;
    };

    tryInject();

    const observer = new MutationObserver(function() {
      if (document.getElementById('principalTeacherAttendancePage')) {
        tryInject();
        if (document.getElementById(V23_PANEL_ID)) {
          observer.disconnect();
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function v23PublicOpen() {
    v23StartObserver();
    setTimeout(v23InjectPanel, 50);
    setTimeout(v23InjectPanel, 300);
    setTimeout(v23InjectPanel, 1000);
  }

  /*
   * Jalankan observer setelah DOM siap. Tidak mengganti fungsi existing.
   */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', v23StartObserver, { once: true });
  } else {
    v23StartObserver();
  }

  /*
   * Observer tetap aktif untuk halaman monitoring yang dibuat secara dinamis.
   */
  window.v23OpenRekapGuruMonitoring = v23PublicOpen;
  window.v23LoadRekapGuruBulanan = v23LoadRecap;
  window.v23ExportRekapGuru = v23Export;
  window.v24DownloadRekapGuru = v23DownloadToDevice;

})();

/* ========================================================================
 * END V23 - REKAP GURU BULANAN + EXPORT EXCEL/PDF
 * ======================================================================== */


/* ========================================================================
 * V2 - SMART PRODUCT FOUNDATION
 * Additive only. Tidak mengubah index.html/style.css, header, scanner,
 * dashboard Guru/Kepala Sekolah, atau alur absensi existing.
 * ======================================================================== */
(function () {
  'use strict';
  async function v2LoadProductPlanInfo() {
    try {
      const result = await apiGet({ action: 'productPlanInfo' });
      if (!result || !result.success) return null;
      return result.data || null;
    } catch (error) {
      console.warn('V2 product plan info gagal dimuat:', error);
      return null;
    }
  }
  window.v2LoadProductPlanInfo = v2LoadProductPlanInfo;
  window.v2SmartProduct = { currentPlan: 'SMART', getInfo: v2LoadProductPlanInfo };
})();

/* ========================================================================
 * END V2 - SMART PRODUCT FOUNDATION
 * ======================================================================== */

/* ========================================================================
 * V2 SMART PRODUCTIZATION FINAL - FRONTEND HELPER
 * Additive only. Tidak membuat panel baru di Dashboard Guru/Kepala Sekolah.
 * ======================================================================== */
(function () {
  'use strict';

  async function v2SmartGetProductInfo() {
    try {
      const result = await apiGet({ action: 'smartProductInfo' });
      if (!result || !result.success) return null;
      return result.data || null;
    } catch (error) {
      console.warn('SMART product info gagal dimuat:', error);
      return null;
    }
  }

  async function v2SmartGetProductStatus() {
    try {
      const token = (typeof currentToken !== 'undefined' ? currentToken : '') || window.currentToken || '';
      const result = await apiGet({ action: 'smartProductStatus', token: token });
      if (!result || !result.success) return null;
      return result.data || null;
    } catch (error) {
      console.warn('SMART product status gagal dimuat:', error);
      return null;
    }
  }

  window.v2SmartGetProductInfo = v2SmartGetProductInfo;
  window.v2SmartGetProductStatus = v2SmartGetProductStatus;
  window.v2SmartProduct = Object.assign(window.v2SmartProduct || {}, {
    currentPlan: 'SMART',
    version: 'SMART-1.0',
    getInfo: v2SmartGetProductInfo,
    getStatus: v2SmartGetProductStatus
  });
})();

/* ========================================================================
 * END V2 SMART PRODUCTIZATION FINAL - FRONTEND HELPER
 * ======================================================================== */

/* ========================================================================
 * V3 SMART PRODUCTIZATION - SETUP OPERASIONAL / ONBOARDING ADMIN
 * Hanya tampil untuk ADMIN. Tidak menyentuh Guru/Kepala Sekolah.
 * ======================================================================== */
(function () {
  'use strict';

  const V3_PANEL_ID = 'v3SmartSetupPanel';
  let v3ObserverStarted = false;

  function v3Role() {
    try {
      return String(
        (typeof currentUser !== 'undefined' && currentUser && currentUser.role) ||
        (window.currentUser && window.currentUser.role) || ''
      ).toUpperCase();
    } catch (e) { return ''; }
  }

  function v3Token() {
    try {
      return (typeof currentToken !== 'undefined' ? currentToken : '') ||
        window.currentToken || '';
    } catch (e) { return window.currentToken || ''; }
  }

  function v3Esc(value) {
    try { return escapeHTML(String(value == null ? '' : value)); }
    catch (e) { return String(value == null ? '' : value); }
  }

  function v3FormatNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString('id-ID') : '0';
  }

  function v3PanelHTML() {
    return `
      <section id="${V3_PANEL_ID}" class="v3-smart-setup-panel" style="
        margin:20px 0;
        padding:20px;
        border:1px solid #dbe4ee;
        border-radius:16px;
        background:#fff;
        box-shadow:0 6px 20px rgba(15,23,42,.06);
      ">
        <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap;">
          <div>
            <div style="font-size:12px;font-weight:700;color:#0f766e;text-transform:uppercase;letter-spacing:.08em;">
              SMART PRODUCT • ADMIN
            </div>
            <h3 style="margin:4px 0 4px;font-size:20px;">⚙️ Setup Operasional SMART</h3>
            <div style="font-size:13px;color:#64748b;">
              Pemeriksaan kesiapan sistem sebelum digunakan sebagai produk sekolah.
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button type="button" id="v3SmartSetupCheckBtn" style="padding:9px 13px;border:0;border-radius:9px;background:#0f766e;color:#fff;font-weight:700;cursor:pointer;">
              🔍 Periksa Sistem
            </button>
            <button type="button" id="v3SmartSetupVerifyBtn" style="padding:9px 13px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;color:#334155;font-weight:700;cursor:pointer;">
              ✅ Verifikasi
            </button>
            <button type="button" id="v3SmartSetupCreateBtn" style="padding:9px 13px;border:0;border-radius:9px;background:#475569;color:#fff;font-weight:700;cursor:pointer;">
              🧩 Buat Sheet Kurang
            </button>
          </div>
        </div>

        <div id="v3SmartSetupMessage" style="margin-top:14px;font-size:13px;"></div>
        <div id="v3SmartSetupSummary" style="margin-top:14px;"></div>
        <div id="v3SmartSetupDetails" style="margin-top:12px;"></div>
      </section>
    `;
  }

  function v3SetMessage(text, type) {
    const el = document.getElementById('v3SmartSetupMessage');
    if (!el) return;
    const color = type === 'error' ? '#b91c1c' : type === 'success' ? '#047857' : '#475569';
    el.innerHTML = `<div style="color:${color};font-weight:600;">${v3Esc(text)}</div>`;
  }

  function v3RenderDashboard(result) {
    const summary = document.getElementById('v3SmartSetupSummary');
    const details = document.getElementById('v3SmartSetupDetails');
    if (!summary || !details) return;

    const data = result && result.data ? result.data : {};
    const wizard = data.wizard && data.wizard.data ? data.wizard.data : null;
    const sheets = data.checks && data.checks[0] && data.checks[0].data
      ? data.checks[0].data : {};

    let sheetTotal = 0, sheetReady = 0, sheetRows = 0;
    Object.keys(sheets).forEach(function(name) {
      sheetTotal++;
      if (sheets[name] && sheets[name].exists) {
        sheetReady++;
        sheetRows += Number(sheets[name].rows || 0);
      }
    });

    const checkOk = (data.checks || []).filter(function(x){ return x.ok; }).length;
    const checkTotal = (data.checks || []).length;
    const ready = sheetTotal > 0 && sheetReady === sheetTotal;

    summary.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;">
        <div style="padding:14px;border-radius:12px;background:#f8fafc;">
          <div style="font-size:11px;color:#64748b;">PAKET</div>
          <div style="font-size:18px;font-weight:800;">⭐ SMART</div>
        </div>
        <div style="padding:14px;border-radius:12px;background:#f8fafc;">
          <div style="font-size:11px;color:#64748b;">SHEET</div>
          <div style="font-size:18px;font-weight:800;">${sheetReady}/${sheetTotal}</div>
        </div>
        <div style="padding:14px;border-radius:12px;background:#f8fafc;">
          <div style="font-size:11px;color:#64748b;">BARIS DATA</div>
          <div style="font-size:18px;font-weight:800;">${v3FormatNumber(sheetRows)}</div>
        </div>
        <div style="padding:14px;border-radius:12px;background:#f8fafc;">
          <div style="font-size:11px;color:#64748b;">PEMERIKSAAN</div>
          <div style="font-size:18px;font-weight:800;">${checkOk}/${checkTotal}</div>
        </div>
      </div>
      <div style="margin-top:10px;padding:10px 12px;border-radius:10px;background:${ready ? '#ecfdf5' : '#fff7ed'};color:${ready ? '#047857' : '#c2410c'};font-weight:700;">
        ${ready ? '✅ Struktur sheet lengkap.' : '⚠️ Masih ada komponen sheet yang perlu diperiksa.'}
      </div>
    `;

    let html = '<div style="font-size:13px;font-weight:800;margin-bottom:8px;">Detail Pemeriksaan</div>';
    html += '<div style="display:grid;gap:6px;">';

    (data.checks || []).forEach(function(item) {
      html += `
        <div style="display:flex;justify-content:space-between;gap:12px;padding:9px 11px;border:1px solid #e2e8f0;border-radius:9px;">
          <span>${v3Esc(item.label)}</span>
          <strong style="color:${item.ok ? '#047857' : '#b91c1c'};">
            ${item.ok ? 'OK' : 'GAGAL'}
          </strong>
        </div>
      `;
    });
    html += '</div>';

    if (wizard) {
      html += `<div style="margin-top:10px;font-size:12px;color:#64748b;">Setup Wizard tersedia dan ikut diperiksa.</div>`;
    }

    details.innerHTML = html;
  }

  async function v3LoadDashboard() {
    if (v3Role() !== 'ADMIN') return;
    v3SetMessage('Sedang memeriksa kesiapan sistem...', 'info');
    try {
      const result = await apiGet({
        action:'smartSetupDashboard',
        token:v3Token()
      });
      if (!result || !result.success) {
        throw new Error((result && (result.message || result.error)) || 'Pemeriksaan gagal.');
      }
      v3RenderDashboard(result);
      v3SetMessage('Pemeriksaan selesai.', 'success');
    } catch (error) {
      console.error('V3 SMART Setup:', error);
      v3SetMessage(error.message || 'Pemeriksaan gagal.', 'error');
    }
  }

  async function v3Verify() {
    if (v3Role() !== 'ADMIN') return;
    v3SetMessage('Memverifikasi struktur dan trigger...', 'info');
    try {
      const result = await apiGet({
        action:'smartSetupVerify',
        token:v3Token()
      });
      if (!result || !result.success) {
        throw new Error((result && (result.message || result.error)) || 'Verifikasi gagal.');
      }
      const data = result.data || {};
      const missingSheets = data.missingSheets || [];
      const missingTriggers = data.missingRecommendedTriggers || [];
      const details = document.getElementById('v3SmartSetupDetails');
      if (details) {
        details.innerHTML = `
          <div style="padding:14px;border-radius:12px;background:${data.ready ? '#ecfdf5' : '#fff7ed'};">
            <strong>${data.ready ? '✅ Struktur siap.' : '⚠️ Struktur belum sepenuhnya siap.'}</strong>
            <div style="margin-top:8px;font-size:13px;">
              Sheet kurang: ${missingSheets.length ? v3Esc(missingSheets.join(', ')) : 'tidak ada'}<br>
              Trigger rekomendasi kurang: ${missingTriggers.length ? v3Esc(missingTriggers.join(', ')) : 'tidak ada'}
            </div>
          </div>
        `;
      }
      v3SetMessage('Verifikasi selesai.', 'success');
    } catch (error) {
      v3SetMessage(error.message || 'Verifikasi gagal.', 'error');
    }
  }

  async function v3CreateMissing() {
    if (v3Role() !== 'ADMIN') return;
    if (!confirm('Buat sheet yang belum tersedia sekarang?')) return;
    v3SetMessage('Membuat sheet yang kurang...', 'info');
    try {
      const result = await apiGet({
        action:'smartSetupCreateMissing',
        token:v3Token()
      });
      if (!result || !result.success) {
        throw new Error((result && (result.message || result.error)) || 'Pembuatan sheet gagal.');
      }
      v3SetMessage('Sheet yang kurang selesai diproses.', 'success');
      await v3LoadDashboard();
    } catch (error) {
      v3SetMessage(error.message || 'Pembuatan sheet gagal.', 'error');
    }
  }

  function v3Inject() {
    if (v3Role() !== 'ADMIN') return false;
    const dashboard = document.getElementById('dashboard');
    if (!dashboard) return false;
    if (document.getElementById(V3_PANEL_ID)) return true;

    const section = document.createElement('div');
    section.innerHTML = v3PanelHTML();
    const panel = section.firstElementChild;
    if (!panel) return false;

    dashboard.appendChild(panel);

    const checkBtn = document.getElementById('v3SmartSetupCheckBtn');
    const verifyBtn = document.getElementById('v3SmartSetupVerifyBtn');
    const createBtn = document.getElementById('v3SmartSetupCreateBtn');

    if (checkBtn) checkBtn.addEventListener('click', v3LoadDashboard);
    if (verifyBtn) verifyBtn.addEventListener('click', v3Verify);
    if (createBtn) createBtn.addEventListener('click', v3CreateMissing);

    setTimeout(v3LoadDashboard, 150);
    return true;
  }

  function v3RemoveIfNotAdmin() {
    if (v3Role() !== 'ADMIN') {
      const old = document.getElementById(V3_PANEL_ID);
      if (old) old.remove();
    }
  }

  function v3StartObserver() {
    if (v3ObserverStarted) return;
    v3ObserverStarted = true;

    const tryInject = function() {
      v3RemoveIfNotAdmin();
      v3Inject();
    };

    tryInject();

    const observer = new MutationObserver(function() {
      tryInject();
    });

    observer.observe(document.body, { childList:true, subtree:true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', v3StartObserver, { once:true });
  } else {
    v3StartObserver();
  }

  window.v3SmartSetup = {
    version:'SMART-1.1',
    refresh:v3LoadDashboard,
    verify:v3Verify
  };
})();

/* ========================================================================
 * END V3 SMART PRODUCTIZATION - SETUP OPERASIONAL / ONBOARDING ADMIN
 * ======================================================================== */


/* ========================================================================
 * V4 SMART PRODUCTIZATION - PROFIL & KONFIGURASI SEKOLAH
 * ------------------------------------------------------------------------
 * Hanya ADMIN. Tidak tampil di Guru/Kepala Sekolah.
 * ======================================================================== */
(function () {
  'use strict';

  const V4_PANEL_ID = 'v4SmartSchoolProfilePanel';
  let v4ObserverStarted = false;

  function v4Role() {
    try {
      return String(
        (typeof currentUser !== 'undefined' && currentUser && currentUser.role) ||
        (window.currentUser && window.currentUser.role) || ''
      ).toUpperCase();
    } catch (e) { return ''; }
  }

  function v4Token() {
    try {
      return (typeof currentToken !== 'undefined' ? currentToken : '') ||
        window.currentToken || '';
    } catch (e) { return window.currentToken || ''; }
  }

  function v4Esc(value) {
    try { return escapeHTML(String(value == null ? '' : value)); }
    catch (e) { return String(value == null ? '' : value); }
  }

  function v4Val(id) {
    const el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }

  function v4SetVal(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value == null ? '' : value;
  }

  function v4PanelHTML() {
    return `
      <section id="${V4_PANEL_ID}" style="
        margin:20px 0;
        padding:20px;
        border:1px solid #dbe4ee;
        border-radius:16px;
        background:#fff;
        box-shadow:0 6px 20px rgba(15,23,42,.06);
      ">
        <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap;">
          <div>
            <div style="font-size:12px;font-weight:700;color:#0f766e;text-transform:uppercase;letter-spacing:.08em;">
              SMART PRODUCT • ADMIN
            </div>
            <h3 style="margin:4px 0;font-size:20px;">🏫 Profil & Konfigurasi Sekolah</h3>
            <div style="font-size:13px;color:#64748b;">
              Identitas sekolah untuk fondasi branding, laporan, onboarding, dan pengembangan produk SMART.
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button type="button" id="v4SmartProfileSetupBtn" style="padding:9px 13px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;color:#334155;font-weight:700;cursor:pointer;">
              🧩 Siapkan Profil
            </button>
            <button type="button" id="v4SmartProfileLoadBtn" style="padding:9px 13px;border:0;border-radius:9px;background:#0f766e;color:#fff;font-weight:700;cursor:pointer;">
              🔄 Muat Data
            </button>
            <button type="button" id="v4SmartProfileSaveBtn" style="padding:9px 13px;border:0;border-radius:9px;background:#475569;color:#fff;font-weight:700;cursor:pointer;">
              💾 Simpan Profil
            </button>
          </div>
        </div>

        <div id="v4SmartProfileMessage" style="margin-top:14px;font-size:13px;"></div>

        <div style="margin-top:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;">
          ${v4Input('v4NamaSekolah','Nama Sekolah *','namaSekolah','text')}
          ${v4Input('v4Npsn','NPSN','npsn','text')}
          ${v4Select('v4Jenjang','Jenjang','jenjang',['','SD','SMP','SMA','SMK','MTs','MA'])}
          ${v4Select('v4StatusSekolah','Status Sekolah','statusSekolah',['AKTIF','NONAKTIF'])}
          ${v4Input('v4Alamat','Alamat','alamat','text')}
          ${v4Input('v4Desa','Desa/Kelurahan','desa','text')}
          ${v4Input('v4Kecamatan','Kecamatan','kecamatan','text')}
          ${v4Input('v4Kabupaten','Kabupaten/Kota','kabupatenKota','text')}
          ${v4Input('v4Provinsi','Provinsi','provinsi','text')}
          ${v4Input('v4KodePos','Kode Pos','kodePos','text')}
          ${v4Input('v4Telepon','Telepon','telepon','text')}
          ${v4Input('v4Email','Email','email','email')}
          ${v4Input('v4Website','Website','website','url')}
          ${v4Input('v4Kepala','Nama Kepala Sekolah','namaKepalaSekolah','text')}
          ${v4Input('v4WaAdmin','No. WhatsApp Admin','noWaAdmin','text')}
          ${v4Input('v4Logo','URL Logo Sekolah','logoUrl','url')}
          ${v4Input('v4TahunAjaran','Tahun Ajaran','tahunAjaran','text')}
          ${v4Select('v4Timezone','Timezone','timezone',['Asia/Jakarta','Asia/Makassar','Asia/Jayapura'])}
        </div>

        <div id="v4SmartProfilePreview" style="margin-top:14px;"></div>
      </section>
    `;
  }

  function v4Input(id, label, key, type) {
    return `<label style="display:block;font-size:12px;font-weight:700;color:#475569;">
      ${v4Esc(label)}
      <input id="${id}" data-v4-key="${v4Esc(key)}" type="${type || 'text'}" style="display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px 11px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;color:#0f172a;">
    </label>`;
  }

  function v4Select(id, label, key, options) {
    return `<label style="display:block;font-size:12px;font-weight:700;color:#475569;">
      ${v4Esc(label)}
      <select id="${id}" data-v4-key="${v4Esc(key)}" style="display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px 11px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;color:#0f172a;">
        ${options.map(function(x){ return `<option value="${v4Esc(x)}">${v4Esc(x || 'Pilih')}</option>`; }).join('')}
      </select>
    </label>`;
  }

  function v4SetMessage(text, type) {
    const el = document.getElementById('v4SmartProfileMessage');
    if (!el) return;
    const color = type === 'error' ? '#b91c1c' : type === 'success' ? '#047857' : '#475569';
    el.innerHTML = `<div style="color:${color};font-weight:600;">${v4Esc(text)}</div>`;
  }

  function v4ReadForm() {
    const data = {};
    document.querySelectorAll('#' + V4_PANEL_ID + ' [data-v4-key]').forEach(function(el) {
      data[el.getAttribute('data-v4-key')] = String(el.value || '').trim();
    });
    return data;
  }

  function v4Render(profile) {
    profile = profile || {};
    v4SetVal('v4NamaSekolah', profile.namaSekolah);
    v4SetVal('v4Npsn', profile.npsn);
    v4SetVal('v4Jenjang', profile.jenjang);
    v4SetVal('v4StatusSekolah', profile.statusSekolah || 'AKTIF');
    v4SetVal('v4Alamat', profile.alamat);
    v4SetVal('v4Desa', profile.desa);
    v4SetVal('v4Kecamatan', profile.kecamatan);
    v4SetVal('v4Kabupaten', profile.kabupatenKota);
    v4SetVal('v4Provinsi', profile.provinsi);
    v4SetVal('v4KodePos', profile.kodePos);
    v4SetVal('v4Telepon', profile.telepon);
    v4SetVal('v4Email', profile.email);
    v4SetVal('v4Website', profile.website);
    v4SetVal('v4Kepala', profile.namaKepalaSekolah);
    v4SetVal('v4WaAdmin', profile.noWaAdmin);
    v4SetVal('v4Logo', profile.logoUrl);
    v4SetVal('v4TahunAjaran', profile.tahunAjaran);
    v4SetVal('v4Timezone', profile.timezone || 'Asia/Jakarta');

    const preview = document.getElementById('v4SmartProfilePreview');
    if (preview) {
      const name = profile.namaSekolah || 'Nama sekolah belum diisi';
      const loc = [profile.kabupatenKota, profile.provinsi].filter(Boolean).join(', ');
      preview.innerHTML = `
        <div style="padding:14px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;">
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:700;">Preview Identitas</div>
          <div style="font-size:18px;font-weight:800;margin-top:3px;">${v4Esc(name)}</div>
          <div style="font-size:13px;color:#64748b;margin-top:3px;">${v4Esc(loc || 'Lokasi belum diisi')}</div>
          <div style="font-size:12px;color:#64748b;margin-top:7px;">NPSN: ${v4Esc(profile.npsn || '-')} • Jenjang: ${v4Esc(profile.jenjang || '-')} • TA: ${v4Esc(profile.tahunAjaran || '-')}</div>
        </div>`;
    }
  }

  async function v4Load() {
    if (v4Role() !== 'ADMIN') return;
    v4SetMessage('Memuat profil sekolah...', 'info');
    try {
      const result = await apiGet({ action:'smartSchoolProfile', token:v4Token() });
      if (!result || !result.success) throw new Error((result && (result.message || result.error)) || 'Profil gagal dimuat.');
      v4Render(result.data && result.data.profile ? result.data.profile : {});
      v4SetMessage('Profil sekolah berhasil dimuat.', 'success');
    } catch (error) {
      console.error('V4 SMART Profil:', error);
      v4SetMessage(error.message || 'Profil gagal dimuat.', 'error');
    }
  }

  async function v4Setup() {
    if (v4Role() !== 'ADMIN') return;
    v4SetMessage('Menyiapkan sheet profil sekolah...', 'info');
    try {
      const result = await apiGet({ action:'smartSchoolProfileSetup', token:v4Token() });
      if (!result || !result.success) throw new Error((result && (result.message || result.error)) || 'Setup profil gagal.');
      v4Render(result.data && result.data.profile ? result.data.profile : {});
      v4SetMessage('Profil sekolah siap digunakan.', 'success');
    } catch (error) {
      v4SetMessage(error.message || 'Setup profil gagal.', 'error');
    }
  }

  async function v4Save() {
    if (v4Role() !== 'ADMIN') return;
    const payload = v4ReadForm();
    if (!payload.namaSekolah) {
      v4SetMessage('Nama Sekolah wajib diisi.', 'error');
      const el = document.getElementById('v4NamaSekolah');
      if (el) el.focus();
      return;
    }
    v4SetMessage('Menyimpan profil sekolah...', 'info');
    try {
      const result = await apiGet({
        action:'smartSchoolProfileSave',
        token:v4Token(),
        payload:JSON.stringify(payload)
      });
      if (!result || !result.success) throw new Error((result && (result.message || result.error)) || 'Profil gagal disimpan.');
      v4Render(result.data && result.data.profile ? result.data.profile : payload);
      v4SetMessage('Profil sekolah berhasil disimpan.', 'success');
    } catch (error) {
      console.error('V4 SMART Profil Save:', error);
      v4SetMessage(error.message || 'Profil gagal disimpan.', 'error');
    }
  }

  function v4Inject() {
    if (v4Role() !== 'ADMIN') return false;
    const dashboard = document.getElementById('dashboard');
    if (!dashboard) return false;
    if (document.getElementById(V4_PANEL_ID)) return true;

    const section = document.createElement('div');
    section.innerHTML = v4PanelHTML();
    const panel = section.firstElementChild;
    if (!panel) return false;
    dashboard.appendChild(panel);

    const setupBtn = document.getElementById('v4SmartProfileSetupBtn');
    const loadBtn = document.getElementById('v4SmartProfileLoadBtn');
    const saveBtn = document.getElementById('v4SmartProfileSaveBtn');
    if (setupBtn) setupBtn.addEventListener('click', v4Setup);
    if (loadBtn) loadBtn.addEventListener('click', v4Load);
    if (saveBtn) saveBtn.addEventListener('click', v4Save);

    setTimeout(v4Load, 150);
    return true;
  }

  function v4RemoveIfNotAdmin() {
    if (v4Role() !== 'ADMIN') {
      const old = document.getElementById(V4_PANEL_ID);
      if (old) old.remove();
    }
  }

  function v4StartObserver() {
    if (v4ObserverStarted) return;
    v4ObserverStarted = true;
    const tryInject = function() {
      v4RemoveIfNotAdmin();
      v4Inject();
    };
    tryInject();
    const observer = new MutationObserver(function() { tryInject(); });
    observer.observe(document.body, { childList:true, subtree:true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', v4StartObserver, { once:true });
  } else {
    v4StartObserver();
  }

  window.v4SmartSchoolProfile = {
    version:'SMART-1.3',
    refresh:v4Load,
    setup:v4Setup,
    save:v4Save
  };
})();

/* ========================================================================
 * END V4 SMART PRODUCTIZATION - PROFIL & KONFIGURASI SEKOLAH
 * ======================================================================== */


/* ========================================================================
 * V5.1 SMART PRODUCTIZATION - IMPORT DATA SEKOLAH
 * Admin-only additive module. CSV / TSV / Excel copy-paste workflow.
 * ======================================================================== */
(function(){
  'use strict';
  const V5_PANEL_ID = 'v5SmartImportPanel';
  const V5_ENTITY_CONFIG = {
    SISWA:{label:'👨‍🎓 Siswa', key:'STUDENT_ID', headers:['STUDENT_ID','NIPD','NISN','NAMA','JK','TEMPAT_LAHIR','TANGGAL_LAHIR','KELAS_ID','KELAS','JENJANG','TAHUN_MASUK','NO_WA_ORANG_TUA','NAMA_ORANG_TUA','STATUS']},
    GURU:{label:'👨‍🏫 Guru', key:'GURU_ID', headers:['GURU_ID','NIP','NAMA_GURU','JENIS_KELAMIN','NO_WA','STATUS']},
    KELAS:{label:'🏫 Kelas', key:'KELAS_ID', headers:['KELAS_ID','NAMA_KELAS','TINGKAT','JURUSAN','WALI_KELAS_ID','STATUS']},
    MAPEL:{label:'📚 Mata Pelajaran', key:'MAPEL_ID', headers:['MAPEL_ID','NAMA_MAPEL','JENJANG','KELOMPOK','STATUS']}
  };
  let v5ObserverStarted = false;
  let v5Rows = [];
  let v5FileName = '';

  function v5Role(){ return (typeof currentUser!=='undefined' && currentUser ? currentUser.role : '') || (window.currentUser && window.currentUser.role) || ''; }
  function v5Token(){ return (typeof currentToken!=='undefined' ? currentToken : '') || window.currentToken || ''; }
  function v5Esc(v){ return (typeof escapeHTML==='function' ? escapeHTML(v) : String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c];})); }
  function v5SetMsg(t,type){ const el=document.getElementById('v5SmartImportMessage'); if(!el)return; el.textContent=t; el.style.color=type==='error'?'#b91c1c':type==='success'?'#047857':'#475569'; }
  function v5Config(){ return V5_ENTITY_CONFIG[document.getElementById('v5ImportEntity')?.value || 'SISWA']; }

  function v5ParseCSV(text){
    const rows=[]; let row=[]; let cell=''; let quote=false;
    for(let i=0;i<text.length;i++){
      const c=text[i], n=text[i+1];
      if(c==='"'){
        if(quote && n==='"'){ cell+='"'; i++; }
        else quote=!quote;
      } else if(c===',' && !quote){ row.push(cell); cell=''; }
      else if((c==='\n'||c==='\r') && !quote){
        if(c==='\r' && n==='\n') i++;
        row.push(cell); cell='';
        if(row.some(function(x){return String(x).trim()!=='';})) rows.push(row);
        row=[];
      } else cell+=c;
    }
    row.push(cell);
    if(row.some(function(x){return String(x).trim()!=='';})) rows.push(row);
    if(!rows.length) return [];
    const headers=rows[0].map(function(h){return String(h).trim().replace(/^\uFEFF/,'');});
    return rows.slice(1).map(function(r){ const o={}; headers.forEach(function(h,i){o[h]=String(r[i]??'').trim();}); return o; });
  }

  function v5ParseTSV(text){
    const lines=text.split(/\r?\n/).filter(function(x){return x.trim()!=='';});
    if(!lines.length)return [];
    const headers=lines[0].split('\t').map(function(x){return x.trim().replace(/^\uFEFF/,'');});
    return lines.slice(1).map(function(line){const vals=line.split('\t'); const o={}; headers.forEach(function(h,i){o[h]=String(vals[i]??'').trim();}); return o;});
  }

  function v5ReadFile(file){
    return new Promise(function(resolve,reject){
      const reader=new FileReader();
      reader.onload=function(){
        try{
          const text=String(reader.result||'');
          const name=String(file.name||'').toLowerCase();
          const rows=(name.endsWith('.tsv')||text.indexOf('\t')>=0) ? v5ParseTSV(text) : v5ParseCSV(text);
          resolve(rows);
        }catch(e){reject(e);}
      };
      reader.onerror=function(){reject(new Error('File tidak dapat dibaca.'));};
      reader.readAsText(file,'UTF-8');
    });
  }

  function v5NormalizeKey(k){ return String(k||'').trim().toUpperCase().replace(/[\s-]+/g,'_'); }
  function v5NormalizeRows(rows){
    const cfg=v5Config();
    const allowed={}; cfg.headers.forEach(function(h){allowed[v5NormalizeKey(h)]=h;});
    const result=[]; const duplicate={}; let emptyRows=0;
    rows.forEach(function(raw){
      const o={}; Object.keys(raw||{}).forEach(function(k){const nk=v5NormalizeKey(k); if(allowed[nk]) o[allowed[nk]]=String(raw[k]??'').trim();});
      if(!Object.keys(o).some(function(k){return o[k]!=='';})){emptyRows++;return;}
      if(!o[cfg.key]) o[cfg.key]='';
      const key=String(o[cfg.key]||'').trim();
      if(key){ if(duplicate[key]) o.__duplicate=true; duplicate[key]=true; }
      result.push(o);
    });
    return {rows:result,emptyRows:emptyRows};
  }

  function v5RenderPreview(){
    const box=document.getElementById('v5SmartImportPreview'); if(!box)return;
    const cfg=v5Config();
    if(!v5Rows.length){box.innerHTML='<div style="color:#64748b;">Belum ada data. Pilih CSV/TSV atau paste data dari Excel.</div>';return;}
    const sample=v5Rows.slice(0,8);
    let html='<div style="font-weight:800;margin-bottom:8px;">Preview '+v5Rows.length+' baris</div><div style="overflow:auto;max-height:320px;border:1px solid #e2e8f0;border-radius:10px;"><table style="border-collapse:collapse;width:100%;font-size:12px;"><thead><tr>';
    cfg.headers.forEach(function(h){html+='<th style="position:sticky;top:0;background:#f8fafc;padding:8px;border-bottom:1px solid #e2e8f0;text-align:left;white-space:nowrap;">'+v5Esc(h)+'</th>';});
    html+='</tr></thead><tbody>';
    sample.forEach(function(r){html+='<tr>';cfg.headers.forEach(function(h){html+='<td style="padding:7px;border-bottom:1px solid #f1f5f9;white-space:nowrap;">'+v5Esc(r[h]||'')+'</td>';});html+='</tr>';});
    html+='</tbody></table></div>';
    if(v5Rows.length>8) html+='<div style="margin-top:6px;font-size:12px;color:#64748b;">Menampilkan 8 baris pertama.</div>';
    box.innerHTML=html;
  }

  function v5DownloadTemplate(){
    const cfg=v5Config();
    const sample={SISWA:['','12345','001122','Contoh Siswa','L','Bogor','2010-01-01','','XI TJKT 1','SMP','2026','','Orang Tua','AKTIF'],GURU:['','198001010001','Contoh Guru','L','62812xxxxxxxx','AKTIF'],KELAS:['','XI TJKT 1','XI','TJKT','','AKTIF'],MAPEL:['','Informatika','SMP','Umum','AKTIF']}[document.getElementById('v5ImportEntity').value];
    const line=cfg.headers.map(function(h,i){return '"'+String(sample[i]??'').replace(/"/g,'""')+'"';}).join(',');
    const blob=new Blob([cfg.headers.join(',')+'\n'+line+'\n'],{type:'text/csv;charset=utf-8;'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='Template_'+document.getElementById('v5ImportEntity').value+'_SMART.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  async function v5LoadStatus(){
    try{
      const r=await apiGet({action:'smartImportStatus',token:v5Token()});
      if(!r||!r.success)throw new Error(r?.message||'Gagal membaca status import.');
      const el=document.getElementById('v5SmartImportStatus'); if(!el)return;
      const entities=r.data?.entities||{}; let html='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;">';
      Object.keys(V5_ENTITY_CONFIG).forEach(function(k){const x=entities[k]||{};html+='<div style="padding:10px;border-radius:10px;background:#f8fafc;"><div style="font-size:11px;color:#64748b;">'+v5Esc(V5_ENTITY_CONFIG[k].label)+'</div><strong>'+v5Esc(x.exists?'SIAP':'BELUM ADA')+'</strong><div style="font-size:11px;color:#64748b;">'+Number(x.rows||0).toLocaleString('id-ID')+' data</div></div>';});
      html+='</div>'; el.innerHTML=html;
    }catch(e){v5SetMsg(e.message||'Gagal membaca status.','error');}
  }

  async function v5Import(){
    if(v5Role()!=='ADMIN')return;
    if(!v5Rows.length){v5SetMsg('Belum ada data untuk diimport.','error');return;}
    const cfg=v5Config();
    const normalized=v5NormalizeRows(v5Rows);
    v5Rows=normalized.rows;
    const missing=v5Rows.filter(function(r){return !r[cfg.key];}).length;
    if(missing){
      if(!confirm('Ada '+missing+' baris tanpa '+cfg.key+'. Sistem akan membuat ID otomatis untuk baris tersebut. Lanjutkan?')) return;
    }
    if(v5Rows.some(function(r){return r.__duplicate;})){v5SetMsg('Ada duplikat '+cfg.key+' dalam data. Perbaiki sebelum import.','error');return;}
    if(!confirm('Import '+v5Rows.length+' baris ke '+cfg.label+'? Data dengan ID yang sudah ada akan diperbarui (upsert).'))return;
    const btn=document.getElementById('v5SmartImportBtn'); if(btn)btn.disabled=true;
    let inserted=0,updated=0,skipped=0,errors=0; const err=[];
    try{
      for(let i=0;i<v5Rows.length;i+=15){
        const chunk=v5Rows.slice(i,i+15).map(function(r){const x=Object.assign({},r);delete x.__duplicate;return x;});
        const r=await apiGet({action:'smartImportData',token:v5Token(),entity:document.getElementById('v5ImportEntity').value,payload:JSON.stringify({rows:chunk})});
        if(!r||!r.success)throw new Error(r?.message||'Import batch gagal pada '+(i+1));
        const d=r.data||{}; inserted+=Number(d.inserted||0);updated+=Number(d.updated||0);skipped+=Number(d.skipped||0);errors+=Number(d.errors||0);(d.errorMessages||[]).forEach(function(x){err.push(x);});
        v5SetMsg('Memproses '+Math.min(i+15,v5Rows.length)+' / '+v5Rows.length+' baris...','info');
      }
      v5SetMsg('Import selesai: '+inserted+' baru, '+updated+' diperbarui, '+skipped+' dilewati, '+errors+' error.','success');
      const result=document.getElementById('v5SmartImportResult'); if(result)result.innerHTML='<div style="padding:12px;border-radius:10px;background:'+(errors?'#fff7ed':'#ecfdf5')+';"><strong>Hasil Import</strong><br>➕ Baru: '+inserted+'<br>🔄 Diperbarui: '+updated+'<br>⏭️ Dilewati: '+skipped+'<br>❌ Error: '+errors+(err.length?'<br><small>'+v5Esc(err.slice(0,10).join(' | '))+'</small>':'')+'</div>';
      await v5LoadStatus();
    }catch(e){console.error('V5 SMART Import:',e);v5SetMsg(e.message||'Import gagal.','error');}
    finally{if(btn)btn.disabled=false;}
  }

  function v5PanelHTML(){return `
    <section id="${V5_PANEL_ID}" style="margin:20px 0;padding:20px;border:1px solid #dbe4ee;border-radius:16px;background:#fff;box-shadow:0 6px 20px rgba(15,23,42,.06);">
      <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap;">
        <div><div style="font-size:12px;font-weight:700;color:#0f766e;text-transform:uppercase;letter-spacing:.08em;">SMART PRODUCT • ADMIN</div><h3 style="margin:4px 0;font-size:20px;">📥 Import Data Sekolah</h3><div style="font-size:13px;color:#64748b;">Import master data secara bertahap. CSV/TSV aman, ID yang sama akan diperbarui.</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;"><button type="button" id="v5SmartImportStatusBtn" style="padding:9px 13px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;font-weight:700;cursor:pointer;">🔍 Cek Data</button><button type="button" id="v5SmartTemplateBtn" style="padding:9px 13px;border:0;border-radius:9px;background:#0f766e;color:#fff;font-weight:700;cursor:pointer;">⬇️ Template</button></div>
      </div>
      <div style="margin-top:14px;display:grid;grid-template-columns:minmax(180px,260px) 1fr;gap:10px;align-items:end;">
        <label style="font-size:12px;font-weight:700;color:#334155;">Jenis Data<select id="v5ImportEntity" style="display:block;width:100%;margin-top:5px;padding:9px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;"><option value="SISWA">👨‍🎓 Siswa</option><option value="GURU">👨‍🏫 Guru</option><option value="KELAS">🏫 Kelas</option><option value="MAPEL">📚 Mata Pelajaran</option></select></label>
        <label style="font-size:12px;font-weight:700;color:#334155;">File CSV/TSV<input id="v5SmartImportFile" type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" style="display:block;width:100%;margin-top:5px;padding:7px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;"></label>
      </div>
      <div style="margin-top:10px;font-size:12px;color:#64748b;">💡 Jika data berasal dari Excel, simpan sebagai <b>CSV UTF-8</b>, atau copy-paste tabel Excel ke kotak di bawah.</div>
      <textarea id="v5SmartImportPaste" placeholder="Paste data Excel/TSV di sini, termasuk baris header..." style="width:100%;min-height:110px;margin-top:10px;padding:10px;border:1px solid #cbd5e1;border-radius:10px;box-sizing:border-box;font:12px monospace;"></textarea>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;"><button type="button" id="v5SmartPreviewBtn" style="padding:9px 13px;border:1px solid #0f766e;border-radius:9px;background:#fff;color:#0f766e;font-weight:700;cursor:pointer;">👁️ Preview</button><button type="button" id="v5SmartImportBtn" style="padding:9px 13px;border:0;border-radius:9px;background:#0f766e;color:#fff;font-weight:700;cursor:pointer;">📥 Import Sekarang</button></div>
      <div id="v5SmartImportMessage" style="margin-top:12px;font-size:13px;font-weight:600;"></div><div id="v5SmartImportPreview" style="margin-top:12px;"><div style="color:#64748b;">Belum ada data.</div></div><div id="v5SmartImportResult" style="margin-top:12px;"></div><div style="margin-top:14px;font-weight:800;font-size:13px;">Status Master Data</div><div id="v5SmartImportStatus" style="margin-top:8px;"></div>
    </section>`;}

  function v5Bind(){
    const entity=document.getElementById('v5ImportEntity');
    const file=document.getElementById('v5SmartImportFile');
    const paste=document.getElementById('v5SmartImportPaste');
    if(entity)entity.addEventListener('change',function(){v5Rows=[];v5RenderPreview();});
    if(file)file.addEventListener('change',async function(){const f=file.files?.[0];if(!f)return;v5FileName=f.name;try{v5Rows=await v5ReadFile(f);v5SetMsg('File '+f.name+' terbaca: '+v5Rows.length+' baris.','success');v5RenderPreview();}catch(e){v5SetMsg(e.message||'Gagal membaca file.','error');}});
    const preview=document.getElementById('v5SmartPreviewBtn'); if(preview)preview.addEventListener('click',function(){if(paste&&paste.value.trim()){const text=paste.value;v5Rows=text.indexOf('\t')>=0?v5ParseTSV(text):v5ParseCSV(text);v5SetMsg('Data paste terbaca: '+v5Rows.length+' baris.','success');}v5RenderPreview();});
    const imp=document.getElementById('v5SmartImportBtn'); if(imp)imp.addEventListener('click',v5Import);
    const stat=document.getElementById('v5SmartImportStatusBtn'); if(stat)stat.addEventListener('click',v5LoadStatus);
    const tpl=document.getElementById('v5SmartTemplateBtn'); if(tpl)tpl.addEventListener('click',v5DownloadTemplate);
    v5LoadStatus();
  }

  function v5Inject(){
    if(v5Role()!=='ADMIN')return false;
    const dashboard=document.getElementById('dashboard'); if(!dashboard)return false;
    if(document.getElementById(V5_PANEL_ID))return true;
    const wrap=document.createElement('div');wrap.innerHTML=v5PanelHTML();const panel=wrap.firstElementChild;if(!panel)return false;dashboard.appendChild(panel);v5Bind();return true;
  }
  function v5Remove(){if(v5Role()!=='ADMIN'){const x=document.getElementById(V5_PANEL_ID);if(x)x.remove();}}
  function v5Start(){if(v5ObserverStarted)return;v5ObserverStarted=true;const run=function(){v5Remove();v5Inject();};run();const ob=new MutationObserver(run);ob.observe(document.body,{childList:true,subtree:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',v5Start,{once:true});else v5Start();
  window.v5SmartImport={version:'SMART-1.4',refresh:v5LoadStatus};
})();

/* ========================================================================
 * END V5.1 SMART PRODUCTIZATION - IMPORT DATA SEKOLAH
 * ======================================================================== */


/* ========================================================================
 * V6 SMART PRODUCTIZATION - SETUP MASTER DATA
 * + V5.2 SISWA.JENJANG FIX
 * Admin-only additive module.
 * ======================================================================== */
(function(){
  'use strict';
  const V6_PANEL_ID='v6SmartMasterPanel';
  let v6Started=false;
  let v6LastValidation=null;

  function v6Role(){return (typeof currentUser!=='undefined'&&currentUser?currentUser.role:'')||(window.currentUser&&window.currentUser.role)||'';}
  function v6Token(){return (typeof currentToken!=='undefined'?currentToken:'')||window.currentToken||'';}
  function v6Esc(v){return (typeof escapeHTML==='function'?escapeHTML(v):String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c];}));}
  function v6Msg(text,type){
    const el=document.getElementById('v6SmartMasterMessage'); if(!el)return;
    el.textContent=text;
    el.style.color=type==='error'?'#b91c1c':type==='success'?'#047857':'#475569';
  }

  async function v6Status(){
    try{
      const r=await apiGet({action:'smartMasterSetupStatus',token:v6Token()});
      if(!r||!r.success)throw new Error(r?.message||'Gagal membaca status master data.');
      const d=r.data||{}, entities=d.entities||{};
      const order=['SISWA','GURU','KELAS','MAPEL'];
      let html='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;">';
      order.forEach(function(k){
        const x=entities[k]||{};
        const ok=x.exists&&x.valid;
        html+='<div style="padding:11px;border:1px solid '+(ok?'#bbf7d0':'#fed7aa')+';border-radius:10px;background:'+(ok?'#f0fdf4':'#fff7ed')+';">'+
          '<div style="font-size:11px;color:#64748b;">'+v6Esc(k)+'</div>'+
          '<strong style="color:'+(ok?'#166534':'#9a3412')+';">'+(ok?'✅ SIAP':'⚠️ PERLU CEK')+'</strong>'+
          '<div style="font-size:11px;color:#64748b;">'+Number(x.rows||0).toLocaleString('id-ID')+' data</div>'+
          (x.missingHeaders&&x.missingHeaders.length?'<div style="font-size:10px;color:#b91c1c;margin-top:4px;">Kurang: '+v6Esc(x.missingHeaders.join(', '))+'</div>':'')+
          '</div>';
      });
      html+='</div>';
      if(d.legacySiswaHeader){
        html+='<div style="margin-top:10px;padding:10px;border-radius:10px;background:#fff7ed;color:#9a3412;font-size:12px;"><b>⚠️ SISWA masih memakai header JENIS_KELAMIN lama.</b> Gunakan tombol Perbaiki SISWA di bawah.</div>';
      } else {
        html+='<div style="margin-top:10px;padding:10px;border-radius:10px;background:#f0fdf4;color:#166534;font-size:12px;"><b>✅ Mapping SISWA:</b> JK = jenis kelamin, JENJANG = jenjang pendidikan.</div>';
      }
      document.getElementById('v6SmartMasterStatus').innerHTML=html;
    }catch(e){v6Msg(e.message||'Gagal membaca status.','error');}
  }

  async function v6Repair(){
    if(v6Role()!=='ADMIN')return;
    if(!confirm('Perbaiki struktur SISWA sekarang? Kolom JENIS_KELAMIN lama akan menjadi JENJANG dan nilai L/P lama akan diperbaiki berdasarkan profil/kelas jika dapat ditentukan.'))return;
    try{
      const r=await apiGet({action:'smartSiswaRepairV52',token:v6Token()});
      if(!r||!r.success)throw new Error(r?.message||'Perbaikan SISWA gagal.');
      const d=r;
      v6Msg('Perbaikan SISWA selesai. '+Number(d.updatedValues||0)+' nilai diperbaiki.','success');
      await v6Status();
    }catch(e){v6Msg(e.message||'Perbaikan gagal.','error');}
  }

  async function v6Validate(){
    if(v6Role()!=='ADMIN')return;
    try{
      v6Msg('Memvalidasi relasi master data...','info');
      const r=await apiGet({action:'smartMasterValidate',token:v6Token()});
      if(!r||!r.success)throw new Error(r?.message||'Validasi gagal.');
      const d=r.data||{};
      v6LastValidation=d;
      const c=d.counts||{};
      const ok=d.status==='SIAP';
      let html='<div style="margin-top:10px;padding:12px;border-radius:10px;background:'+(ok?'#ecfdf5':'#fff7ed')+';color:'+(ok?'#166534':'#9a3412')+';">'+
        '<b>'+(ok?'✅ MASTER DATA SIAP':'⚠️ MASTER DATA PERLU PERBAIKAN')+'</b>'+
        '<div style="margin-top:6px;font-size:12px;">Siswa tanpa kelas: '+Number(c.siswaClassMissing||0)+
        ' · Nama kelas tidak cocok: '+Number(c.siswaClassNameMismatch||0)+
        ' · Wali guru tidak ditemukan: '+Number(c.waliGuruMissing||0)+
        ' · Jadwal-Guru: '+Number(c.jadwalGuruMissing||0)+
        ' · Jadwal-Kelas: '+Number(c.jadwalKelasMissing||0)+
        ' · Jadwal-Mapel: '+Number(c.jadwalMapelMissing||0)+
        ' · Mapel tanpa jenjang: '+Number(c.mapelJenjangEmpty||0)+'</div></div>';
      if(d.issues&&d.issues.length){
        html+='<div style="margin-top:8px;max-height:220px;overflow:auto;border:1px solid #e2e8f0;border-radius:10px;"><table style="width:100%;border-collapse:collapse;font-size:11px;"><thead><tr><th style="padding:7px;text-align:left;background:#f8fafc;">Jenis</th><th style="padding:7px;text-align:left;background:#f8fafc;">ID</th><th style="padding:7px;text-align:left;background:#f8fafc;">Keterangan</th></tr></thead><tbody>';
        d.issues.slice(0,50).forEach(function(x){
          html+='<tr><td style="padding:6px;border-top:1px solid #f1f5f9;">'+v6Esc(x.type)+'</td><td style="padding:6px;border-top:1px solid #f1f5f9;">'+v6Esc(x.id)+'</td><td style="padding:6px;border-top:1px solid #f1f5f9;">'+v6Esc(x.message)+'</td></tr>';
        });
        html+='</tbody></table></div>';
      }
      document.getElementById('v6SmartMasterValidation').innerHTML=html;
      v6Msg('Validasi master data selesai.','success');
    }catch(e){v6Msg(e.message||'Validasi gagal.','error');}
  }

  function v6PanelHTML(){return `
    <section id="${V6_PANEL_ID}" style="margin:20px 0;padding:20px;border:1px solid #dbe4ee;border-radius:16px;background:#fff;box-shadow:0 6px 20px rgba(15,23,42,.06);">
      <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap;">
        <div>
          <div style="font-size:12px;font-weight:700;color:#0f766e;text-transform:uppercase;letter-spacing:.08em;">SMART PRODUCT • ADMIN</div>
          <h3 style="margin:4px 0;font-size:20px;">🧩 Setup Master Data SMART</h3>
          <div style="font-size:13px;color:#64748b;">Cek hubungan Siswa, Guru, Kelas, Mata Pelajaran, dan Jadwal sebelum sekolah baru digunakan.</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" id="v6SmartMasterStatusBtn" style="padding:9px 13px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;font-weight:700;cursor:pointer;">🔍 Cek Master</button>
          <button type="button" id="v6SmartMasterValidateBtn" style="padding:9px 13px;border:0;border-radius:9px;background:#0f766e;color:#fff;font-weight:700;cursor:pointer;">✅ Validasi Relasi</button>
        </div>
      </div>
      <div style="margin-top:12px;padding:11px;border-radius:10px;background:#f8fafc;font-size:12px;color:#475569;">
        <b>V5.2 Fix:</b> Kolom SISWA menggunakan <b>JK</b> untuk jenis kelamin dan <b>JENJANG</b> untuk jenjang pendidikan.
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
        <button type="button" id="v6SmartMasterRepairBtn" style="padding:9px 13px;border:1px solid #f59e0b;border-radius:9px;background:#fff7ed;color:#9a3412;font-weight:800;cursor:pointer;">🔧 Perbaiki SISWA</button>
      </div>
      <div id="v6SmartMasterMessage" style="margin-top:12px;font-size:13px;font-weight:600;"></div>
      <div style="margin-top:14px;font-weight:800;font-size:13px;">Status Master Data</div>
      <div id="v6SmartMasterStatus" style="margin-top:8px;"></div>
      <div style="margin-top:14px;font-weight:800;font-size:13px;">Hasil Validasi Relasi</div>
      <div id="v6SmartMasterValidation" style="margin-top:8px;"><div style="color:#64748b;">Belum divalidasi.</div></div>
    </section>`;}

  function v6Bind(){
    const s=document.getElementById('v6SmartMasterStatusBtn');if(s)s.addEventListener('click',v6Status);
    const v=document.getElementById('v6SmartMasterValidateBtn');if(v)v.addEventListener('click',v6Validate);
    const r=document.getElementById('v6SmartMasterRepairBtn');if(r)r.addEventListener('click',v6Repair);
    v6Status();
  }

  function v6Inject(){
    if(v6Role()!=='ADMIN')return false;
    const dashboard=document.getElementById('dashboard');if(!dashboard)return false;
    if(document.getElementById(V6_PANEL_ID))return true;
    const wrap=document.createElement('div');wrap.innerHTML=v6PanelHTML();const panel=wrap.firstElementChild;if(!panel)return false;
    dashboard.appendChild(panel);v6Bind();return true;
  }

  function v6Remove(){
    if(v6Role()!=='ADMIN'){
      const x=document.getElementById(V6_PANEL_ID);if(x)x.remove();
    }
  }

  function v6Start(){
    if(v6Started)return;v6Started=true;
    const run=function(){v6Remove();v6Inject();};
    run();
    const ob=new MutationObserver(run);ob.observe(document.body,{childList:true,subtree:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',v6Start,{once:true});else v6Start();

  window.v6SmartMaster={
    version:'SMART-1.6',
    refresh:v6Status,
    validate:v6Validate,
    repairSiswa:v6Repair
  };
})();

/* ========================================================================
 * END V6 SMART PRODUCTIZATION - SETUP MASTER DATA + V5.2 JENJANG FIX
 * ======================================================================== */

/* ========================================================================
 * V7 SMART PRODUCTIZATION - SETUP JADWAL
 * Admin-only additive module.
 * ======================================================================== */
(function(){
  'use strict';
  const V7_PANEL_ID='v7SmartSchedulePanel';
  let v7Started=false;

  function v7Role(){return (typeof currentUser!=='undefined'&&currentUser?currentUser.role:'')||(window.currentUser&&window.currentUser.role)||'';}
  function v7Token(){return (typeof currentToken!=='undefined'?currentToken:'')||window.currentToken||'';}
  function v7Esc(v){return (typeof escapeHTML==='function'?escapeHTML(v):String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c];}));}
  function v7Msg(t,type){const e=document.getElementById('v7SmartScheduleMessage');if(!e)return;e.textContent=t;e.style.color=type==='error'?'#b91c1c':type==='success'?'#047857':'#475569';}
  function v7Input(){return document.getElementById('v7SmartSchedulePaste');}
  function v71File(){return document.getElementById('v7SmartScheduleFile');}
  function v71ReadFile(){const f=v71File()?.files?.[0];if(!f){v7Msg('Pilih file CSV/TSV terlebih dahulu.','error');return;} const reader=new FileReader(); reader.onload=function(e){const text=String(e.target.result||'');const input=v7Input();if(input)input.value=text;v7Preview();v7Msg('File '+f.name+' berhasil dimuat. Silakan cek Preview sebelum import.','success');}; reader.onerror=function(){v7Msg('File tidak dapat dibaca.','error');}; reader.readAsText(f,'UTF-8');}
  function v7RowsFromText(text){
    text=String(text||'').trim();
    if(!text)return [];
    const lines=text.split(/\r?\n/).filter(x=>x.trim());
    if(!lines.length)return [];
    const delim=lines[0].indexOf('\t')>=0?'\t':',';
    const headers=lines[0].split(delim).map(x=>x.trim().replace(/^"|"$/g,''));
    return lines.slice(1).map(function(line){
      const cells=[];let cur='',quote=false;
      for(let i=0;i<line.length;i++){
        const ch=line[i];
        if(ch==='"'){if(quote&&line[i+1]==='"'){cur+='"';i++;}else quote=!quote;}
        else if(ch===delim&&!quote){cells.push(cur);cur='';}
        else cur+=ch;
      }
      cells.push(cur);
      const obj={};headers.forEach((h,i)=>obj[h]=String(cells[i]??'').trim());return obj;
    });
  }
  function v7Payload(){return JSON.stringify({rows:v7RowsFromText(v7Input()?.value||'')});}

  async function v7Setup(){
    try{
      const r=await apiGet({action:'smartScheduleSetup',token:v7Token()});
      if(!r?.success)throw new Error(r?.message||'Gagal membaca setup jadwal.');
      const d=r.data||{};
      const status=document.getElementById('v7SmartScheduleStatus');
      if(status)status.innerHTML='<div style="padding:10px;border-radius:10px;background:'+(d.ready?'#f0fdf4':'#fff7ed')+';color:'+(d.ready?'#166534':'#9a3412')+';"><b>'+(d.ready?'✅ JADWAL SIAP':'⚠️ JADWAL PERLU CEK')+'</b><div style="font-size:12px;margin-top:4px;">'+Number(d.rows||0).toLocaleString('id-ID')+' data · '+v7Esc((d.missingHeaders||[]).length?'Kurang: '+d.missingHeaders.join(', '):'Struktur header lengkap')+'</div></div>';
    }catch(e){v7Msg(e.message||'Gagal membaca setup.','error');}
  }

  async function v7Validate(){
    try{
      v7Msg('Memvalidasi JADWAL...','info');
      const r=await apiGet({action:'smartScheduleValidate',token:v7Token()});
      if(!r?.success)throw new Error(r?.message||'Validasi JADWAL gagal.');
      const d=r.data||{},c=d.counts||{};
      let h='<div style="padding:11px;border-radius:10px;background:'+(d.status==='SIAP'?'#ecfdf5':'#fff7ed')+';color:'+(d.status==='SIAP'?'#166534':'#9a3412')+';"><b>'+(d.status==='SIAP'?'✅ JADWAL SIAP':'⚠️ JADWAL PERLU PERBAIKAN')+'</b><div style="font-size:12px;margin-top:5px;">Total: '+Number(c.total||0)+' · Valid: '+Number(c.valid||0)+' · Invalid: '+Number(c.invalid||0)+' · Kelas tidak ditemukan: '+Number(c.kelasMissing||0)+' · Guru: '+Number(c.guruMissing||0)+' · Mapel: '+Number(c.mapelMissing||0)+' · Jam: '+Number(c.timeInvalid||0)+' · Bentrok kelas: '+Number(c.classConflict||0)+' · Bentrok guru: '+Number(c.teacherConflict||0)+'</div></div>';
      if(d.issues?.length){h+='<div style="margin-top:8px;max-height:220px;overflow:auto;border:1px solid #e2e8f0;border-radius:10px;"><table style="width:100%;border-collapse:collapse;font-size:11px;"><thead><tr><th style="padding:6px;text-align:left;background:#f8fafc;">Baris</th><th style="padding:6px;text-align:left;background:#f8fafc;">JADWAL_ID</th><th style="padding:6px;text-align:left;background:#f8fafc;">Keterangan</th></tr></thead><tbody>';d.issues.slice(0,50).forEach(x=>h+='<tr><td style="padding:6px;border-top:1px solid #f1f5f9;">'+v7Esc(x.row)+'</td><td style="padding:6px;border-top:1px solid #f1f5f9;">'+v7Esc(x.id)+'</td><td style="padding:6px;border-top:1px solid #f1f5f9;">'+v7Esc(x.message)+'</td></tr>');h+='</tbody></table></div>'}
      document.getElementById('v7SmartScheduleValidation').innerHTML=h;v7Msg('Validasi JADWAL selesai.','success');
    }catch(e){v7Msg(e.message||'Validasi gagal.','error');}
  }

  function v7Preview(){
    const rows=v7RowsFromText(v7Input()?.value||'');
    const el=document.getElementById('v7SmartSchedulePreview');
    if(!rows.length){el.innerHTML='<div style="color:#64748b;">Belum ada data untuk preview.</div>';return;}
    const headers=['JADWAL_ID','HARI','JAM_KE','JAM_MULAI','JAM_SELESAI','KELAS_ID','KELAS','MAPEL_ID','MAPEL','GURU_ID','GURU','STATUS'];
    let h='<div style="font-weight:800;margin-bottom:7px;">Preview '+rows.length+' baris</div><div style="overflow:auto;border:1px solid #e2e8f0;border-radius:10px;"><table style="border-collapse:collapse;min-width:100%;font-size:11px;"><thead><tr>';headers.forEach(x=>h+='<th style="padding:7px;text-align:left;background:#f8fafc;white-space:nowrap;">'+v7Esc(x)+'</th>');h+='</tr></thead><tbody>';rows.slice(0,15).forEach(r=>{h+='<tr>';headers.forEach(x=>h+='<td style="padding:7px;border-top:1px solid #f1f5f9;white-space:nowrap;">'+v7Esc(r[x])+'</td>');h+='</tr>'});h+='</tbody></table></div>';el.innerHTML=h;
  }

  async function v7Import(){
    const rows=v7RowsFromText(v7Input()?.value||'');
    if(!rows.length){v7Msg('Tidak ada data jadwal untuk diimport.','error');return;}
    if(rows.length>15){v7Msg('Maksimal 15 jadwal per import. Pecah menjadi beberapa batch.','error');return;}
    if(!confirm('Import '+rows.length+' jadwal sekarang? Data akan divalidasi terlebih dahulu dan import dibatalkan jika ada bentrok/error.'))return;
    try{
      v7Msg('Memvalidasi dan mengimport JADWAL...','info');
      const r=await apiGet({action:'smartScheduleImport',token:v7Token(),payload:v7Payload()});
      if(!r?.success)throw new Error(r?.message||'Import JADWAL gagal.');
      const d=r.data||{};v7Msg('Import berhasil. Baru: '+Number(d.inserted||0)+' · Diperbarui: '+Number(d.updated||0)+' · Error: '+Number(d.errors||0),'success');
      await v7Setup();await v7Validate();
    }catch(e){v7Msg(e.message||'Import gagal.','error');}
  }

  async function v7Repair(){
    if(!confirm('Normalisasi data JADWAL sekarang? Sistem akan merapikan HARI, JAM_MULAI, JAM_SELESAI, dan STATUS tanpa mengubah relasi ID.'))return;
    try{v7Msg('Memperbaiki format JADWAL...','info');const r=await apiGet({action:'smartScheduleRepair',token:v7Token()});if(!r?.success)throw new Error(r?.message||'Perbaikan gagal.');v7Msg('Perbaikan JADWAL selesai. '+Number(r.data?.updatedValues||0)+' nilai dinormalisasi.','success');await v7Setup();await v7Validate();}catch(e){v7Msg(e.message||'Perbaikan gagal.','error');}
  }

  function v7Template(){
    const h='JADWAL_ID,HARI,JAM_KE,JAM_MULAI,JAM_SELESAI,KELAS_ID,KELAS,MAPEL_ID,MAPEL,GURU_ID,GURU,STATUS\n,JUMAT,1,07:30,08:15,KLS001,XI TJKT 1,MPL001,Informatika,GRU001,Nama Guru,AKTIF';
    const blob=new Blob([h],{type:'text/csv;charset=utf-8;'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='Template_JADWAL_SMART.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }

  function v7PanelHTML(){return `
<section id="${V7_PANEL_ID}" style="margin:20px 0;padding:20px;border:1px solid #dbe4ee;border-radius:16px;background:#fff;box-shadow:0 6px 20px rgba(15,23,42,.06);">
<div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap;"><div><div style="font-size:12px;font-weight:700;color:#0f766e;text-transform:uppercase;letter-spacing:.08em;">SMART PRODUCT • ADMIN</div><h3 style="margin:4px 0;font-size:20px;">📅 Setup Jadwal SMART</h3><div style="font-size:13px;color:#64748b;">Validasi dan import jadwal setelah master Siswa, Guru, Kelas, dan Mata Pelajaran siap.</div></div><div style="display:flex;gap:8px;flex-wrap:wrap;"><button type="button" id="v7SmartScheduleSetupBtn" style="padding:9px 13px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;font-weight:700;cursor:pointer;">🔍 Cek Jadwal</button><button type="button" id="v7SmartScheduleValidateBtn" style="padding:9px 13px;border:0;border-radius:9px;background:#0f766e;color:#fff;font-weight:700;cursor:pointer;">✅ Validasi Jadwal</button></div></div>
<div style="margin-top:12px;padding:11px;border-radius:10px;background:#f8fafc;font-size:12px;color:#475569;"><b>Aturan:</b> HARI + JAM_KE + KELAS_ID tidak boleh bentrok, HARI + JAM_KE + GURU_ID tidak boleh bentrok, dan KELAS/GURU/MAPEL harus sudah ada di master.</div>
<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;"><label for="v7SmartScheduleFile" style="padding:9px 13px;border:1px solid #0f766e;border-radius:9px;background:#fff;color:#0f766e;font-weight:800;cursor:pointer;display:inline-block;">🔎 TELUSURI</label><input id="v7SmartScheduleFile" type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" style="display:none;"><button type="button" id="v7SmartScheduleLoadFileBtn" style="padding:9px 13px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;font-weight:800;cursor:pointer;">📂 Muat File</button><button type="button" id="v7SmartScheduleTemplateBtn" style="padding:9px 13px;border:1px solid #0f766e;border-radius:9px;background:#fff;color:#0f766e;font-weight:800;cursor:pointer;">⬇️ Template JADWAL</button><button type="button" id="v7SmartSchedulePreviewBtn" style="padding:9px 13px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;font-weight:800;cursor:pointer;">👁️ Preview</button><button type="button" id="v7SmartScheduleImportBtn" style="padding:9px 13px;border:0;border-radius:9px;background:#0f766e;color:#fff;font-weight:800;cursor:pointer;">📥 Import JADWAL</button><button type="button" id="v7SmartScheduleRepairBtn" style="padding:9px 13px;border:1px solid #f59e0b;border-radius:9px;background:#fff7ed;color:#9a3412;font-weight:800;cursor:pointer;">🔧 Normalisasi</button></div>
<div style="margin-top:8px;font-size:12px;color:#64748b;">Format yang didukung untuk tombol Telusuri: <b>CSV/TSV/TXT UTF-8</b>. File Excel XLSX tetap dapat digunakan dengan copy-paste tabel ke kotak di bawah.</div><textarea id="v7SmartSchedulePaste" style="width:100%;min-height:150px;margin-top:10px;padding:10px;border:1px solid #cbd5e1;border-radius:10px;font-family:monospace;font-size:11px;box-sizing:border-box;" placeholder="Paste data Excel/CSV/TSV di sini, termasuk header..."></textarea>
<div id="v7SmartScheduleMessage" style="margin-top:10px;font-size:13px;font-weight:600;"></div>
<div style="margin-top:12px;font-weight:800;font-size:13px;">Status JADWAL</div><div id="v7SmartScheduleStatus" style="margin-top:8px;"></div>
<div style="margin-top:12px;font-weight:800;font-size:13px;">Preview Import</div><div id="v7SmartSchedulePreview" style="margin-top:8px;"><div style="color:#64748b;">Belum ada preview.</div></div>
<div style="margin-top:12px;font-weight:800;font-size:13px;">Hasil Validasi</div><div id="v7SmartScheduleValidation" style="margin-top:8px;"><div style="color:#64748b;">Belum divalidasi.</div></div>
</section>`;}

  function v7Bind(){
    document.getElementById('v7SmartScheduleSetupBtn')?.addEventListener('click',v7Setup);
    document.getElementById('v7SmartScheduleValidateBtn')?.addEventListener('click',v7Validate);
    document.getElementById('v7SmartScheduleTemplateBtn')?.addEventListener('click',v7Template);
    document.getElementById('v7SmartScheduleLoadFileBtn')?.addEventListener('click',v71ReadFile);
    document.getElementById('v7SmartScheduleFile')?.addEventListener('change',v71ReadFile);
    document.getElementById('v7SmartSchedulePreviewBtn')?.addEventListener('click',v7Preview);
    document.getElementById('v7SmartScheduleImportBtn')?.addEventListener('click',v7Import);
    document.getElementById('v7SmartScheduleRepairBtn')?.addEventListener('click',v7Repair);
    v7Setup();
  }
  function v7Inject(){if(v7Role()!=='ADMIN')return false;const dashboard=document.getElementById('dashboard');if(!dashboard)return false;if(document.getElementById(V7_PANEL_ID))return true;const w=document.createElement('div');w.innerHTML=v7PanelHTML();const p=w.firstElementChild;if(!p)return false;dashboard.appendChild(p);v7Bind();return true;}
  function v7Remove(){if(v7Role()!=='ADMIN'){document.getElementById(V7_PANEL_ID)?.remove();}}
  function v7Start(){if(v7Started)return;v7Started=true;const run=()=>{v7Remove();v7Inject();};run();new MutationObserver(run).observe(document.body,{childList:true,subtree:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',v7Start,{once:true});else v7Start();
  window.v7SmartSchedule={version:'SMART-1.7.1',refresh:v7Setup,validate:v7Validate,preview:v7Preview,import:v7Import,repair:v7Repair};
})();

/* ========================================================================
 * END V7 SMART PRODUCTIZATION - SETUP JADWAL
 * ======================================================================== */


/* V7.1 SMART PRODUCTIZATION - JADWAL VALIDATION + FILE BROWSER FIX */



/* ========================================================================
 * V8 SMART PRODUCTIZATION - WIZARD SEKOLAH BARU
 * ------------------------------------------------------------------------
 * Panel ADMIN only. Tidak mengubah index.html/style.css.
 * ======================================================================== */
(function(){
  'use strict';
  const V8_PANEL_ID='v8SmartNewSchoolWizardPanel';
  let started=false;

  function role(){return String((typeof currentUser!=='undefined'&&currentUser?.role)||window.currentUser?.role||'').toUpperCase();}
  function token(){return (typeof currentToken!=='undefined'&&currentToken)||window.currentToken||'';}
  function esc(v){return typeof escapeHTML==='function'?escapeHTML(String(v??'')):String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\'':'&#39;','"':'&quot;'}[c]));}
  function msg(text,type){const el=document.getElementById('v8SmartWizardMessage');if(!el)return;el.textContent=text||'';el.style.color=type==='error'?'#b91c1c':type==='success'?'#047857':'#475569';}

  function stepButton(id){
    const map={
      PROFILE:'v4SmartSchoolProfilePanel',
      SISWA:'v5SmartImportPanel',
      GURU:'v5SmartImportPanel',
      KELAS:'v5SmartImportPanel',
      MAPEL:'v5SmartImportPanel',
      JADWAL:'v7SmartSchedulePanel',
      VALIDATION:'v6SmartMasterPanel'
    };
    const target=map[id];
    if(target){const el=document.getElementById(target);if(el){el.scrollIntoView({behavior:'smooth',block:'start'});return;}}
    const dashboard=document.getElementById('dashboard');dashboard?.scrollIntoView({behavior:'smooth',block:'start'});
  }

  function render(data){
    const box=document.getElementById('v8SmartWizardContent'); if(!box)return;
    const pct=Number(data.progress||0);
    const color=pct===100?'#16a34a':pct>=70?'#0f766e':'#f59e0b';
    let html='';
    html+='<div style="margin-top:12px;padding:14px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;">';
    html+='<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;"><b>Progress onboarding</b><b>'+pct+'%</b></div>';
    html+='<div style="height:10px;background:#e2e8f0;border-radius:999px;overflow:hidden;margin-top:8px;"><div style="width:'+Math.max(0,Math.min(100,pct))+'%;height:100%;background:'+color+';transition:width .25s;"></div></div>';
    html+='<div style="margin-top:8px;font-size:12px;color:#64748b;">'+Number(data.readyCount||0)+' dari '+Number(data.totalSteps||0)+' tahap siap.</div></div>';

    html+='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin-top:12px;">';
    (data.steps||[]).forEach(function(s){
      const ok=!!s.ready;
      html+='<div style="border:1px solid '+(ok?'#bbf7d0':'#fde68a')+';background:'+(ok?'#f0fdf4':'#fffbeb')+';border-radius:12px;padding:12px;">';
      html+='<div style="font-weight:800;">'+(ok?'✅':'⚠️')+' '+esc(s.title)+'</div>';
      html+='<div style="font-size:12px;color:#64748b;margin-top:4px;">'+esc(s.count||'')+'</div>';
      html+='<div style="font-size:12px;margin-top:7px;line-height:1.45;">'+esc(s.detail||'')+'</div>';
      if(!ok) html+='<button type="button" data-v8-step="'+esc(s.id)+'" style="margin-top:9px;padding:7px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;font-weight:700;cursor:pointer;">Buka Tahap</button>';
      html+='</div>';
    });
    html+='</div>';

    if(data.ready){
      html+='<div style="margin-top:12px;padding:13px;border-radius:11px;background:#ecfdf5;color:#065f46;font-weight:800;">🎉 Checklist dasar sekolah baru sudah lengkap. Sistem siap masuk tahap pilot/operasional.</div>';
    }else if(data.next){
      html+='<div style="margin-top:12px;padding:13px;border-radius:11px;background:#fff7ed;color:#9a3412;"><b>➡️ Tahap berikutnya:</b> '+esc(data.next.title)+'<br><span style="font-size:12px;">'+esc(data.next.detail||'')+'</span></div>';
    }

    if(data.details?.jadwal?.issues?.length){
      html+='<details style="margin-top:12px;"><summary style="cursor:pointer;font-weight:800;">Lihat masalah jadwal (maks. 20)</summary><div style="overflow:auto;margin-top:8px;"><table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr><th style="text-align:left;padding:7px;border-bottom:1px solid #e2e8f0;">Baris</th><th style="text-align:left;padding:7px;border-bottom:1px solid #e2e8f0;">ID</th><th style="text-align:left;padding:7px;border-bottom:1px solid #e2e8f0;">Keterangan</th></tr></thead><tbody>';
      data.details.jadwal.issues.forEach(function(x){html+='<tr><td style="padding:7px;border-bottom:1px solid #f1f5f9;">'+esc(x.row)+'</td><td style="padding:7px;border-bottom:1px solid #f1f5f9;">'+esc(x.id)+'</td><td style="padding:7px;border-bottom:1px solid #f1f5f9;">'+esc(x.message)+'</td></tr>';});
      html+='</tbody></table></div></details>';
    }
    box.innerHTML=html;
    box.querySelectorAll('[data-v8-step]').forEach(function(btn){btn.addEventListener('click',function(){stepButton(btn.getAttribute('data-v8-step'));});});
  }

  async function check(){
    if(role()!=='ADMIN')return;
    try{
      msg('Memeriksa kesiapan sekolah baru...','info');
      const r=await apiGet({action:'smartNewSchoolWizard',token:token()});
      if(!r?.success)throw new Error(r?.message||'Pemeriksaan gagal.');
      render(r.data||{});
      msg('Pemeriksaan onboarding selesai.','success');
    }catch(e){msg(e.message||'Pemeriksaan gagal.','error');}
  }

  function html(){return `
<section id="${V8_PANEL_ID}" style="margin:20px 0;padding:20px;border:1px solid #dbe4ee;border-radius:16px;background:#fff;box-shadow:0 6px 20px rgba(15,23,42,.06);">
<div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap;"><div><div style="font-size:12px;font-weight:700;color:#0f766e;text-transform:uppercase;letter-spacing:.08em;">SMART PRODUCT • ADMIN</div><h3 style="margin:4px 0;font-size:20px;">🧭 Wizard Sekolah Baru</h3><div style="font-size:13px;color:#64748b;">Satu halaman untuk memeriksa kesiapan Profil, Master Data, Jadwal, dan validasi sebelum sistem dipakai di sekolah baru.</div></div><button type="button" id="v8SmartWizardCheckBtn" style="padding:9px 13px;border:0;border-radius:9px;background:#0f766e;color:#fff;font-weight:800;cursor:pointer;">🔍 Cek Kesiapan Sekolah</button></div>
<div style="margin-top:10px;padding:11px;border-radius:10px;background:#f8fafc;color:#475569;font-size:12px;">Wizard ini <b>tidak mengubah data</b>. Fungsinya hanya membaca kondisi sistem dan mengarahkan ADMIN ke tahap yang masih perlu diselesaikan.</div>
<div id="v8SmartWizardMessage" style="margin-top:10px;font-size:13px;font-weight:700;"></div>
<div id="v8SmartWizardContent" style="margin-top:10px;"><div style="color:#64748b;">Klik <b>🔍 Cek Kesiapan Sekolah</b> untuk memulai.</div></div>
</section>`;}

  function inject(){
    if(role()!=='ADMIN')return false;
    const dash=document.getElementById('dashboard'); if(!dash)return false;
    if(document.getElementById(V8_PANEL_ID))return true;
    const wrap=document.createElement('div');wrap.innerHTML=html();const panel=wrap.firstElementChild;if(!panel)return false;
    dash.appendChild(panel);
    document.getElementById('v8SmartWizardCheckBtn')?.addEventListener('click',check);
    check();
    return true;
  }
  function remove(){if(role()!=='ADMIN')document.getElementById(V8_PANEL_ID)?.remove();}
  function start(){if(started)return;started=true;const run=()=>{remove();inject();};run();new MutationObserver(run).observe(document.body,{childList:true,subtree:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  window.v8SmartNewSchoolWizard={version:'SMART-1.8.2',refresh:check};
})();

/* ========================================================================
 * END V8 SMART PRODUCTIZATION - WIZARD SEKOLAH BARU
 * ======================================================================== */


/* ========================================================================
 * V8 SMART PRODUCTIZATION - WIZARD SEKOLAH BARU
 * ------------------------------------------------------------------------
 * Panel ADMIN only. Tidak mengubah index.html/style.css.
 * ======================================================================== */
(function(){
  'use strict';
  const V8_PANEL_ID='v8SmartNewSchoolWizardPanel';
  let started=false;

  function role(){return String((typeof currentUser!=='undefined'&&currentUser?.role)||window.currentUser?.role||'').toUpperCase();}
  function token(){return (typeof currentToken!=='undefined'&&currentToken)||window.currentToken||'';}
  function esc(v){return typeof escapeHTML==='function'?escapeHTML(String(v??'')):String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\'':'&#39;','"':'&quot;'}[c]));}
  function msg(text,type){const el=document.getElementById('v8SmartWizardMessage');if(!el)return;el.textContent=text||'';el.style.color=type==='error'?'#b91c1c':type==='success'?'#047857':'#475569';}

  function stepButton(id){
    const map={
      PROFILE:'v4SmartSchoolProfilePanel',
      SISWA:'v5SmartImportPanel',
      GURU:'v5SmartImportPanel',
      KELAS:'v5SmartImportPanel',
      MAPEL:'v5SmartImportPanel',
      JADWAL:'v7SmartSchedulePanel',
      VALIDATION:'v6SmartMasterPanel'
    };
    const target=map[id];
    if(target){const el=document.getElementById(target);if(el){el.scrollIntoView({behavior:'smooth',block:'start'});return;}}
    const dashboard=document.getElementById('dashboard');dashboard?.scrollIntoView({behavior:'smooth',block:'start'});
  }

  function render(data){
    const box=document.getElementById('v8SmartWizardContent'); if(!box)return;
    const pct=Number(data.progress||0);
    const color=pct===100?'#16a34a':pct>=70?'#0f766e':'#f59e0b';
    let html='';
    html+='<div style="margin-top:12px;padding:14px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;">';
    html+='<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;"><b>Progress onboarding</b><b>'+pct+'%</b></div>';
    html+='<div style="height:10px;background:#e2e8f0;border-radius:999px;overflow:hidden;margin-top:8px;"><div style="width:'+Math.max(0,Math.min(100,pct))+'%;height:100%;background:'+color+';transition:width .25s;"></div></div>';
    html+='<div style="margin-top:8px;font-size:12px;color:#64748b;">'+Number(data.readyCount||0)+' dari '+Number(data.totalSteps||0)+' tahap siap.</div></div>';

    html+='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin-top:12px;">';
    (data.steps||[]).forEach(function(s){
      const ok=!!s.ready;
      html+='<div style="border:1px solid '+(ok?'#bbf7d0':'#fde68a')+';background:'+(ok?'#f0fdf4':'#fffbeb')+';border-radius:12px;padding:12px;">';
      html+='<div style="font-weight:800;">'+(ok?'✅':'⚠️')+' '+esc(s.title)+'</div>';
      html+='<div style="font-size:12px;color:#64748b;margin-top:4px;">'+esc(s.count||'')+'</div>';
      html+='<div style="font-size:12px;margin-top:7px;line-height:1.45;">'+esc(s.detail||'')+'</div>';
      if(!ok) html+='<button type="button" data-v8-step="'+esc(s.id)+'" style="margin-top:9px;padding:7px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;font-weight:700;cursor:pointer;">Buka Tahap</button>';
      html+='</div>';
    });
    html+='</div>';

    if(data.ready){
      html+='<div style="margin-top:12px;padding:13px;border-radius:11px;background:#ecfdf5;color:#065f46;font-weight:800;">🎉 Checklist dasar sekolah baru sudah lengkap. Sistem siap masuk tahap pilot/operasional.</div>';
    }else if(data.next){
      html+='<div style="margin-top:12px;padding:13px;border-radius:11px;background:#fff7ed;color:#9a3412;"><b>➡️ Tahap berikutnya:</b> '+esc(data.next.title)+'<br><span style="font-size:12px;">'+esc(data.next.detail||'')+'</span></div>';
    }

    if(data.details?.jadwal?.issues?.length){
      html+='<details style="margin-top:12px;"><summary style="cursor:pointer;font-weight:800;">Lihat masalah jadwal (maks. 20)</summary><div style="overflow:auto;margin-top:8px;"><table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr><th style="text-align:left;padding:7px;border-bottom:1px solid #e2e8f0;">Baris</th><th style="text-align:left;padding:7px;border-bottom:1px solid #e2e8f0;">ID</th><th style="text-align:left;padding:7px;border-bottom:1px solid #e2e8f0;">Keterangan</th></tr></thead><tbody>';
      data.details.jadwal.issues.forEach(function(x){html+='<tr><td style="padding:7px;border-bottom:1px solid #f1f5f9;">'+esc(x.row)+'</td><td style="padding:7px;border-bottom:1px solid #f1f5f9;">'+esc(x.id)+'</td><td style="padding:7px;border-bottom:1px solid #f1f5f9;">'+esc(x.message)+'</td></tr>';});
      html+='</tbody></table></div></details>';
    }
    box.innerHTML=html;
    box.querySelectorAll('[data-v8-step]').forEach(function(btn){btn.addEventListener('click',function(){stepButton(btn.getAttribute('data-v8-step'));});});
  }

  async function check(){
    if(role()!=='ADMIN')return;
    try{
      msg('Memeriksa kesiapan sekolah baru...','info');
      const r=await apiGet({action:'smartNewSchoolWizard',token:token()});
      if(!r?.success)throw new Error(r?.message||'Pemeriksaan gagal.');
      render(r.data||{});
      msg('Pemeriksaan onboarding selesai.','success');
    }catch(e){msg(e.message||'Pemeriksaan gagal.','error');}
  }

  function html(){return `
<section id="${V8_PANEL_ID}" style="margin:20px 0;padding:20px;border:1px solid #dbe4ee;border-radius:16px;background:#fff;box-shadow:0 6px 20px rgba(15,23,42,.06);">
<div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap;"><div><div style="font-size:12px;font-weight:700;color:#0f766e;text-transform:uppercase;letter-spacing:.08em;">SMART PRODUCT • ADMIN</div><h3 style="margin:4px 0;font-size:20px;">🧭 Wizard Sekolah Baru</h3><div style="font-size:13px;color:#64748b;">Satu halaman untuk memeriksa kesiapan Profil, Master Data, Jadwal, dan validasi sebelum sistem dipakai di sekolah baru.</div></div><button type="button" id="v8SmartWizardCheckBtn" style="padding:9px 13px;border:0;border-radius:9px;background:#0f766e;color:#fff;font-weight:800;cursor:pointer;">🔍 Cek Kesiapan Sekolah</button></div>
<div style="margin-top:10px;padding:11px;border-radius:10px;background:#f8fafc;color:#475569;font-size:12px;">Wizard ini <b>tidak mengubah data</b>. Fungsinya hanya membaca kondisi sistem dan mengarahkan ADMIN ke tahap yang masih perlu diselesaikan.</div>
<div id="v8SmartWizardMessage" style="margin-top:10px;font-size:13px;font-weight:700;"></div>
<div id="v8SmartWizardContent" style="margin-top:10px;"><div style="color:#64748b;">Klik <b>🔍 Cek Kesiapan Sekolah</b> untuk memulai.</div></div>
</section>`;}

  function inject(){
    if(role()!=='ADMIN')return false;
    const dash=document.getElementById('dashboard'); if(!dash)return false;
    if(document.getElementById(V8_PANEL_ID))return true;
    const wrap=document.createElement('div');wrap.innerHTML=html();const panel=wrap.firstElementChild;if(!panel)return false;
    dash.appendChild(panel);
    document.getElementById('v8SmartWizardCheckBtn')?.addEventListener('click',check);
    check();
    return true;
  }
  function remove(){if(role()!=='ADMIN')document.getElementById(V8_PANEL_ID)?.remove();}
  function start(){if(started)return;started=true;const run=()=>{remove();inject();};run();new MutationObserver(run).observe(document.body,{childList:true,subtree:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  window.v8SmartNewSchoolWizard={version:'SMART-1.8.2',refresh:check};
})();

/* ========================================================================
 * END V8 SMART PRODUCTIZATION - WIZARD SEKOLAH BARU
 * ======================================================================== */


/* ========================================================================
 * V9 SMART PRODUCTIZATION - PILOT SCHOOL CONTROL CENTER
 * ------------------------------------------------------------------------
 * ADMIN ONLY. Tidak mengubah index.html/style.css.
 * Pilot bersifat monitoring, tidak membuat absensi test/palsu.
 * ======================================================================== */
(function(){
  'use strict';
  const PANEL_ID='v9SmartPilotPanel';
  let started=false;
  function role(){return String((typeof currentUser!=='undefined'&&currentUser?.role)||window.currentUser?.role||'').toUpperCase();}
  function token(){return (typeof currentToken!=='undefined'&&currentToken)||window.currentToken||'';}
  function esc(v){return typeof escapeHTML==='function'?escapeHTML(String(v??'')):String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\'':'&#39;','"':'&quot;'}[c]));}
  function msg(t,type){const e=document.getElementById('v9PilotMsg');if(!e)return;e.textContent=t||'';e.style.color=type==='error'?'#b91c1c':type==='success'?'#047857':'#475569';}
  function btn(id,fn){document.getElementById(id)?.addEventListener('click',fn);}
  async function api(action,extra){return await apiGet(Object.assign({action:action,token:token()},extra||{}));}
  function card(title,value,sub){return '<div style="padding:12px;border:1px solid #dbe4ee;border-radius:12px;background:#fff;"><div style="font-size:11px;color:#64748b;font-weight:700;">'+esc(title)+'</div><div style="font-size:21px;font-weight:900;margin-top:4px;">'+esc(value)+'</div><div style="font-size:11px;color:#64748b;margin-top:3px;">'+esc(sub||'')+'</div></div>';}
  function render(d){
    const box=document.getElementById('v9PilotContent');if(!box)return;
    let h='';
    const a=d.activePilot;
    if(a){
      h+='<div style="padding:14px;border-radius:12px;background:#ecfdf5;border:1px solid #bbf7d0;"><b>🟢 Pilot AKTIF</b><div style="font-size:13px;margin-top:5px;">'+esc(a.school)+' · '+esc(a.start)+' s/d '+esc(a.end)+' · PIC: '+esc(a.pic)+'</div><button id="v9PilotCloseBtn" type="button" style="margin-top:9px;padding:8px 12px;border:0;border-radius:8px;background:#b91c1c;color:#fff;font-weight:800;cursor:pointer;">⏹️ Tutup Pilot</button></div>';
      const m=d.metrics||{attendance:{},teacher:{},wa:{}};
      const base=d.baseline||{};
      h+='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:9px;margin-top:10px;">';
      h+=card('Record ABSENSI',m.attendance?.records??0,'baseline '+(base.absensi??0));
      h+=card('Siswa Unik',m.attendance?.uniqueStudents??0,'baseline '+(base.uniqueSiswa??0));
      h+=card('Terlambat',m.attendance?.terlambat??0,'baseline '+(base.terlambat??0));
      h+=card('Alpa',m.attendance?.alpa??0,'baseline '+(base.alpa??0));
      h+=card('Presensi Guru',m.teacher?.records??0,'baseline '+(base.guruAbsensi??0));
      h+=card('WA Terkirim',m.wa?.sent??0,'baseline '+(base.waSent??0));
      h+=card('WA Gagal',m.wa?.failed??0,'baseline '+(base.waFailed??0));
      h+='</div>';
    } else {
      h+='<div style="padding:14px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;"><b>⚪ Belum ada pilot aktif.</b><div style="font-size:12px;color:#64748b;margin-top:4px;">Mulai pilot untuk merekam baseline dan mengamati operasional sekolah selama periode uji.</div></div>';
    }
    h+='<div style="margin-top:14px;font-weight:900;">🧪 Checklist Pilot</div>';
    const c=d.checklist||{};
    h+='<div style="margin-top:8px;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;">';
    (c.checks||[]).forEach(x=>{h+='<div style="padding:10px;border-radius:10px;background:'+(x.ready?'#f0fdf4':'#fffbeb')+';border:1px solid '+(x.ready?'#bbf7d0':'#fde68a')+';"><b>'+(x.ready?'✅':'⚠️')+' '+esc(x.label)+'</b><div style="font-size:11px;color:#64748b;margin-top:3px;">'+esc(x.detail)+'</div></div>';});
    h+='</div>';
    h+='<div style="margin-top:14px;font-weight:900;">📝 Catat Issue Pilot</div><div style="display:grid;grid-template-columns:120px 160px 1fr;gap:8px;margin-top:7px;align-items:center;"><select id="v9IssueLevel" style="padding:8px;border:1px solid #cbd5e1;border-radius:8px;"><option>INFO</option><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>CRITICAL</option></select><input id="v9IssueModule" placeholder="Modul, mis. WA" style="padding:8px;border:1px solid #cbd5e1;border-radius:8px;"><input id="v9IssueDesc" placeholder="Deskripsi masalah" style="padding:8px;border:1px solid #cbd5e1;border-radius:8px;"></div><button id="v9IssueBtn" type="button" style="margin-top:8px;padding:8px 12px;border:0;border-radius:8px;background:#0f766e;color:#fff;font-weight:800;cursor:pointer;">📝 Simpan Issue</button>';
    h+='<div style="margin-top:14px;font-weight:900;">📚 Riwayat Pilot</div><div style="overflow:auto;margin-top:7px;"><table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr><th style="text-align:left;padding:7px;border-bottom:1px solid #e2e8f0;">Sekolah</th><th style="text-align:left;padding:7px;border-bottom:1px solid #e2e8f0;">Mulai</th><th style="text-align:left;padding:7px;border-bottom:1px solid #e2e8f0;">Selesai</th><th style="text-align:left;padding:7px;border-bottom:1px solid #e2e8f0;">Status</th></tr></thead><tbody>';
    (d.history||[]).forEach(x=>{h+='<tr><td style="padding:7px;border-bottom:1px solid #f1f5f9;">'+esc(x.school)+'</td><td style="padding:7px;border-bottom:1px solid #f1f5f9;">'+esc(x.start)+'</td><td style="padding:7px;border-bottom:1px solid #f1f5f9;">'+esc(x.end)+'</td><td style="padding:7px;border-bottom:1px solid #f1f5f9;">'+esc(x.status)+'</td></tr>';});
    h+='</tbody></table></div>';
    if(d.issues?.length){h+='<details style="margin-top:10px;"><summary style="font-weight:800;cursor:pointer;">Lihat 20 issue terakhir</summary><div style="overflow:auto;margin-top:7px;"><table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr><th>ID</th><th>Level</th><th>Modul</th><th>Deskripsi</th><th>Status</th></tr></thead><tbody>';d.issues.forEach(x=>{h+='<tr><td>'+esc(x.id)+'</td><td>'+esc(x.level)+'</td><td>'+esc(x.module)+'</td><td>'+esc(x.description)+'</td><td>'+esc(x.status)+'</td></tr>';});h+='</tbody></table></div></details>';}
    box.innerHTML=h;
    btn('v9PilotCloseBtn',closePilot);btn('v9IssueBtn',saveIssue);
  }
  async function refresh(){if(role()!=='ADMIN')return;try{msg('Memuat Pusat Pilot...','info');const r=await api('smartPilotDashboard');if(!r?.success)throw new Error(r?.message||'Gagal memuat pilot.');render(r.data||{});msg('Pusat Pilot siap.','success');}catch(e){msg(e.message||'Gagal memuat pilot.','error');}}
  async function setup(){try{const r=await api('smartPilotSetup');if(!r?.success)throw new Error(r?.message||'Setup pilot gagal.');await refresh();}catch(e){msg(e.message||'Setup gagal.','error');}}
  async function startPilot(){
    if(!confirm('Mulai pilot sekolah sekarang? Sistem hanya mencatat baseline dan monitoring, tidak membuat absensi palsu.'))return;
    const school=prompt('Nama sekolah pilot:', ''); if(school===null)return;
    const days=prompt('Durasi pilot (hari):','30'); if(days===null)return;
    const n=Math.max(1,parseInt(days,10)||30);const now=new Date();const end=new Date(now.getTime()+(n-1)*86400000);
    const fmt=x=>{const y=x.getFullYear(),m=String(x.getMonth()+1).padStart(2,'0'),d=String(x.getDate()).padStart(2,'0');return y+'-'+m+'-'+d;};
    try{msg('Memulai pilot...','info');const r=await api('smartPilotStart',{payload:JSON.stringify({school:school.trim(),start:fmt(now),end:fmt(end),pic:'ADMIN',appVersion:'SMART-1.9.0',apiVersion:'SMART-1.9.0'})});if(!r?.success)throw new Error(r?.message||'Gagal memulai pilot.');await refresh();}catch(e){msg(e.message||'Gagal memulai pilot.','error');}
  }
  async function closePilot(){if(!confirm('Tutup pilot aktif? Data absensi tidak akan dihapus.'))return;try{msg('Menutup pilot...','info');const r=await api('smartPilotClose');if(!r?.success)throw new Error(r?.message||'Gagal menutup pilot.');await refresh();}catch(e){msg(e.message||'Gagal menutup pilot.','error');}}
  async function saveIssue(){const level=document.getElementById('v9IssueLevel')?.value||'INFO',module=document.getElementById('v9IssueModule')?.value||'',description=document.getElementById('v9IssueDesc')?.value||'';if(!description.trim()){msg('Deskripsi issue wajib diisi.','error');return;}try{msg('Menyimpan issue...','info');const r=await api('smartPilotIssue',{payload:JSON.stringify({level:level,module:module,description:description,pic:'ADMIN'})});if(!r?.success)throw new Error(r?.message||'Gagal menyimpan issue.');await refresh();}catch(e){msg(e.message||'Gagal menyimpan issue.','error');}}
  function html(){return '<section id="'+PANEL_ID+'" style="margin:20px 0;padding:20px;border:1px solid #dbe4ee;border-radius:16px;background:#fff;box-shadow:0 6px 20px rgba(15,23,42,.06);"><div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;"><div><div style="font-size:12px;font-weight:700;color:#0f766e;text-transform:uppercase;letter-spacing:.08em;">SMART PRODUCT • ADMIN</div><h3 style="margin:4px 0;font-size:20px;">🧪 Pilot School Control Center</h3><div style="font-size:13px;color:#64748b;">Monitoring sekolah pilot selama ±1 bulan sebelum ekspansi ke sekolah berikutnya.</div></div><div style="display:flex;gap:7px;flex-wrap:wrap;"><button id="v9PilotStartBtn" type="button" style="padding:9px 12px;border:0;border-radius:9px;background:#0f766e;color:#fff;font-weight:800;cursor:pointer;">▶️ Mulai Pilot</button><button id="v9PilotRefreshBtn" type="button" style="padding:9px 12px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;font-weight:800;cursor:pointer;">🔄 Refresh</button></div></div><div id="v9PilotMsg" style="margin-top:9px;font-size:13px;font-weight:700;"></div><div id="v9PilotContent" style="margin-top:10px;"><div style="color:#64748b;">Memuat...</div></div></section>';}
  function inject(){if(role()!=='ADMIN')return false;const dash=document.getElementById('dashboard');if(!dash)return false;if(document.getElementById(PANEL_ID))return true;const w=document.createElement('div');w.innerHTML=html();const p=w.firstElementChild;if(!p)return false;dash.appendChild(p);btn('v9PilotStartBtn',startPilot);btn('v9PilotRefreshBtn',refresh);setup();return true;}
  function remove(){if(role()!=='ADMIN')document.getElementById(PANEL_ID)?.remove();}
  function start(){if(started)return;started=true;const run=()=>{remove();inject();};run();new MutationObserver(run).observe(document.body,{childList:true,subtree:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  window.v9SmartPilot={version:'SMART-1.9.0',refresh:refresh,start:startPilot,close:closePilot};
})();

/* ========================================================================
 * END V9 SMART PRODUCTIZATION - PILOT SCHOOL CONTROL CENTER
 * ======================================================================== */
