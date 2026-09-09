/****************************************************
 * SISTEM KARTU PELAJAR & ABSENSI
 * SMP & SMA BAITUL ULUM BOARDING SCHOOL
 *
 * BACKEND V1.2
 *
 * FUNGSI:
 * - API GET Absensi
 * - API POST Absensi
 * - Validasi siswa
 * - Validasi status siswa
 * - Cek absensi hari ini
 * - Status Hadir / Terlambat
 * - Pencegahan absensi ganda
 * - Simpan ABSENSI
 * - Simpan LOG
 * - Rekap absensi hari ini
 * - Web App
 ****************************************************/


/* =====================================================
   KONFIGURASI SHEET
===================================================== */

const CONFIG = {

  SHEET_SISWA:
    'SISWA',

  SHEET_KARTU:
    'KARTU',

  SHEET_ABSENSI:
    'ABSENSI',

  SHEET_PENGATURAN:
    'PENGATURAN',

  SHEET_LOG:
    'LOG'

};


/* =====================================================
   WEB APP
===================================================== */

/**
 * =====================================================
 * DO GET
 * =====================================================
 *
 * API:
 *
 * ?action=attendance&studentId=BU-2026-0005
 *
 * ?action=summary
 *
 * Jika tanpa action:
 * tampilkan halaman Index
 *
 */

function doGet(e) {

  try {

    const params =
      e && e.parameter
        ? e.parameter
        : {};

    const action =
      String(
        params.action || ''
      ).trim();


    /* =================================================
       API ABSENSI
    ================================================= */

    if (
      action === 'attendance'
    ) {

      const studentId =
        String(
          params.studentId || ''
        ).trim();


      if (!studentId) {

        return createApiResponse({

          success: false,

          status:
            'ERROR',

          message:
            'Student ID kosong.'

        });

      }


      const result =
        processAttendance(
          studentId
        );


      return createApiResponse(
        result
      );

    }


    /* =================================================
       API REKAP HARI INI
    ================================================= */

    if (
      action === 'summary'
    ) {

      const summary =
        getTodaySummary();


      return createApiResponse(
        summary
      );

    }


    /* =================================================
       JIKA TIDAK ADA ACTION
    ================================================= */

    if (!action) {

      return HtmlService

        .createTemplateFromFile(
          'Index'
        )

        .evaluate()

        .setTitle(
          'Absensi Siswa - SMP Baitul Ulum'
        )

        .setXFrameOptionsMode(
          HtmlService
            .XFrameOptionsMode
            .ALLOWALL
        );

    }


    /* =================================================
       ACTION TIDAK DIKENAL
    ================================================= */

    return createApiResponse({

      success: false,

      status:
        'ERROR',

      message:
        'Action tidak dikenali: ' +
        action

    });


  }

  catch (error) {

    console.error(
      'DO GET ERROR:',
      error
    );


    return createApiResponse({

      success: false,

      status:
        'ERROR',

      message:
        error.message ||
        'Terjadi kesalahan server.'

    });

  }

}


/* =====================================================
   API POST
===================================================== */

/**
 * Format JSON:
 *
 * {
 *   "action": "attendance",
 *   "studentId": "BU-2026-0005"
 * }
 */

function doPost(e) {

  try {

    /* ==========================================
       CEK REQUEST
    ========================================== */

    if (
      !e ||
      !e.postData ||
      !e.postData.contents
    ) {

      return createApiResponse({

        success: false,

        status:
          'ERROR',

        message:
          'Request POST tidak memiliki data.'

      });

    }


    /* ==========================================
       PARSE JSON
    ========================================== */

    const data =
      JSON.parse(
        e.postData.contents
      );


    /* ==========================================
       ACTION
    ========================================== */

    const action =
      String(
        data.action || ''
      ).trim();


    /* ==========================================
       STUDENT ID
    ========================================== */

    const studentId =
      String(
        data.studentId || ''
      ).trim();


    /* ==========================================
       VALIDASI ACTION
    ========================================== */

    if (!action) {

      return createApiResponse({

        success: false,

        status:
          'ERROR',

        message:
          'Action tidak ditemukan.'

      });

    }


    if (
      action !== 'attendance'
    ) {

      return createApiResponse({

        success: false,

        status:
          'ERROR',

        message:
          'Action tidak dikenali: ' +
          action

      });

    }


    /* ==========================================
       VALIDASI STUDENT ID
    ========================================== */

    if (!studentId) {

      return createApiResponse({

        success: false,

        status:
          'ERROR',

        message:
          'Student ID kosong.'

      });

    }


    /* ==========================================
       PROSES ABSENSI
    ========================================== */

    const result =
      processAttendance(
        studentId
      );


    return createApiResponse(
      result
    );


  }

  catch (error) {

    console.error(
      'DO POST ERROR:',
      error
    );


    return createApiResponse({

      success: false,

      status:
        'ERROR',

      message:
        error.message ||
        'Terjadi kesalahan server.'

    });

  }

}


/* =====================================================
   RESPONSE API
===================================================== */

function createApiResponse(
  data
) {

  return ContentService

    .createTextOutput(
      JSON.stringify(data)
    )

    .setMimeType(
      ContentService.MimeType.JSON
    );

}


/* =====================================================
   INCLUDE HTML
===================================================== */

function include(
  filename
) {

  return HtmlService

    .createHtmlOutputFromFile(
      filename
    )

    .getContent();

}


/* =====================================================
   SPREADSHEET
===================================================== */

function getSpreadsheet() {

  return SpreadsheetApp
    .getActiveSpreadsheet();

}


/* =====================================================
   PENGATURAN
===================================================== */

/**
 * Struktur PENGATURAN:
 *
 * A = PARAMETER
 * B = NILAI
 *
 * Contoh:
 *
 * JAM_MASUK
 * 07:00
 *
 * BATAS_HADIR
 * 07:15
 */

function getSettings() {

  const ss =
    getSpreadsheet();


  const sheet =
    ss.getSheetByName(
      CONFIG.SHEET_PENGATURAN
    );


  if (!sheet) {

    throw new Error(
      'Sheet PENGATURAN tidak ditemukan.'
    );

  }


  const data =
    sheet
      .getDataRange()
      .getValues();


  const settings = {};


  for (
    let i = 1;
    i < data.length;
    i++
  ) {

    const parameter =
      String(
        data[i][0] || ''
      ).trim();


    const nilai =
      data[i][1];


    if (
      parameter !== ''
    ) {

      settings[parameter] =
        nilai;

    }

  }


  return settings;

}


/* =====================================================
   DATA SISWA
===================================================== */

function getStudentById(
  studentId
) {

  studentId =
    String(
      studentId || ''
    ).trim();


  if (!studentId) {

    return {

      success: false,

      message:
        'Student ID kosong.'

    };

  }


  const ss =
    getSpreadsheet();


  const sheet =
    ss.getSheetByName(
      CONFIG.SHEET_SISWA
    );


  if (!sheet) {

    throw new Error(
      'Sheet SISWA tidak ditemukan.'
    );

  }


  const data =
    sheet
      .getDataRange()
      .getValues();


  if (
    data.length < 2
  ) {

    return {

      success: false,

      message:
        'Belum ada data siswa.'

    };

  }


  for (
    let i = 1;
    i < data.length;
    i++
  ) {

    const id =
      String(
        data[i][0] || ''
      ).trim();


    if (
      id === studentId
    ) {

      return {

        success: true,

        student: {

          studentId:
            id,

          nis:
            data[i][1],

          nisn:
            data[i][2],

          nama:
            data[i][3],

          jk:
            data[i][4],

          tempatLahir:
            data[i][5],

          tanggalLahir:
            data[i][6],

          kelas:
            data[i][7],

          tahunMasuk:
            data[i][8],

          alamat:
            data[i][9],

          status:
            data[i][10],

          foto:
            data[i][11]

        }

      };

    }

  }


  return {

    success: false,

    message:
      'Student ID tidak ditemukan.'

  };

}


/* =====================================================
   CEK ABSENSI HARI INI
===================================================== */

function checkTodayAttendance(
  studentId
) {

  studentId =
    String(
      studentId || ''
    ).trim();


  const ss =
    getSpreadsheet();


  const sheet =
    ss.getSheetByName(
      CONFIG.SHEET_ABSENSI
    );


  if (!sheet) {

    throw new Error(
      'Sheet ABSENSI tidak ditemukan.'
    );

  }


  const lastRow =
    sheet.getLastRow();


  if (
    lastRow < 2
  ) {

    return {

      exists: false

    };

  }


  /*
   * Ambil A:J
   */

  const data =
    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        10
      )
      .getValues();


  const timezone =
    Session.getScriptTimeZone() ||
    'Asia/Jakarta';


  const today =
    Utilities.formatDate(
      new Date(),
      timezone,
      'yyyy-MM-dd'
    );


  for (
    let i = 0;
    i < data.length;
    i++
  ) {

    const timestamp =
      data[i][0];


    const id =
      String(
        data[i][3] || ''
      ).trim();


    if (
      !timestamp ||
      id !== studentId
    ) {

      continue;

    }


    const dateString =
      Utilities.formatDate(
        new Date(timestamp),
        timezone,
        'yyyy-MM-dd'
      );


    if (
      dateString === today
    ) {

      return {

        exists: true,

        timestamp:
          timestamp,

        jam:
          Utilities.formatDate(
            new Date(timestamp),
            timezone,
            'HH:mm:ss'
          ),

        status:
          data[i][6]

      };

    }

  }


  return {

    exists: false

  };

}


/* =====================================================
   KONVERSI WAKTU
===================================================== */

function timeToMinutes(
  value
) {

  /* ==========================================
     DATE
  ========================================== */

  if (
    value instanceof Date
  ) {

    return (
      value.getHours() * 60 +
      value.getMinutes()
    );

  }


  /* ==========================================
     NUMBER
  ========================================== */

  if (
    typeof value === 'number'
  ) {

    return Math.round(
      value * 24 * 60
    );

  }


  /* ==========================================
     TEXT
  ========================================== */

  const text =
    String(
      value || ''
    ).trim();


  const parts =
    text.split(':');


  if (
    parts.length >= 2
  ) {

    const hours =
      parseInt(
        parts[0],
        10
      );


    const minutes =
      parseInt(
        parts[1],
        10
      );


    if (
      !isNaN(hours) &&
      !isNaN(minutes)
    ) {

      return (
        hours * 60 +
        minutes
      );

    }

  }


  throw new Error(
    'Format waktu tidak valid: ' +
    value
  );

}


/* =====================================================
   STATUS HADIR / TERLAMBAT
===================================================== */

function determineAttendanceStatus() {

  const settings =
    getSettings();


  const batasHadir =
    settings.BATAS_HADIR ||
    '07:15';


  const now =
    new Date();


  const timezone =
    Session.getScriptTimeZone() ||
    'Asia/Jakarta';


  const currentTime =
    Utilities.formatDate(
      now,
      timezone,
      'HH:mm'
    );


  const currentMinutes =
    timeToMinutes(
      currentTime
    );


  const batasMinutes =
    timeToMinutes(
      batasHadir
    );


  if (
    currentMinutes <=
    batasMinutes
  ) {

    return 'Hadir';

  }


  return 'Terlambat';

}


/* =====================================================
   LOG
===================================================== */

function writeLog(
  studentId,
  action,
  result,
  description
) {

  const ss =
    getSpreadsheet();


  const sheet =
    ss.getSheetByName(
      CONFIG.SHEET_LOG
    );


  if (!sheet) {

    throw new Error(
      'Sheet LOG tidak ditemukan.'
    );

  }


  sheet.appendRow([

    new Date(),

    studentId,

    action,

    result,

    description

  ]);

}


/* =====================================================
   PROSES ABSENSI
===================================================== */

function processAttendance(
  studentId
) {

  studentId =
    String(
      studentId || ''
    ).trim();


  /* ==========================================
     VALIDASI ID
  ========================================== */

  if (!studentId) {

    try {

      writeLog(
        '',
        'SCAN',
        'GAGAL',
        'Student ID kosong'
      );

    }

    catch (error) {

      console.error(
        error
      );

    }


    return {

      success: false,

      status:
        'ERROR',

      message:
        'Student ID kosong.'

    };

  }


  /* ==========================================
     1. CARI SISWA
  ========================================== */

  const studentResult =
    getStudentById(
      studentId
    );


  if (
    !studentResult.success
  ) {

    try {

      writeLog(
        studentId,
        'SCAN',
        'GAGAL',
        'Student ID tidak ditemukan'
      );

    }

    catch (error) {

      console.error(
        error
      );

    }


    return {

      success: false,

      status:
        'NOT_FOUND',

      message:
        'Data siswa tidak ditemukan.'

    };

  }


  const student =
    studentResult.student;


  /* ==========================================
     2. STATUS SISWA
  ========================================== */

  if (
    String(
      student.status || ''
    )
      .trim()
      .toLowerCase() !==
    'aktif'
  ) {

    writeLog(
      studentId,
      'SCAN',
      'DITOLAK',
      'Siswa tidak aktif'
    );


    return {

      success: false,

      status:
        'INACTIVE',

      message:
        'Siswa tidak aktif.',

      student:
        student

    };

  }


  /* ==========================================
     3. LOCK
  ========================================== */

  const lock =
    LockService
      .getScriptLock();


  try {

    lock.waitLock(
      10000
    );


    /* ========================================
       4. CEK ABSENSI HARI INI
    ======================================== */

    const todayAttendance =
      checkTodayAttendance(
        studentId
      );


    if (
      todayAttendance.exists
    ) {

      writeLog(
        studentId,
        'SCAN',
        'DITOLAK',
        'Siswa sudah melakukan absensi'
      );


      return {

        success: false,

        status:
          'ALREADY',

        message:
          'Siswa sudah melakukan absensi hari ini.',

        student:
          student,

        previousAttendance:
          todayAttendance

      };

    }


    /* ========================================
       5. STATUS HADIR / TERLAMBAT
    ======================================== */

    const attendanceStatus =
      determineAttendanceStatus();


    /* ========================================
       6. WAKTU
    ======================================== */

    const now =
      new Date();


    const timezone =
      Session.getScriptTimeZone() ||
      'Asia/Jakarta';


    const tanggal =
      Utilities.formatDate(
        now,
        timezone,
        'dd/MM/yyyy'
      );


    const jam =
      Utilities.formatDate(
        now,
        timezone,
        'HH:mm:ss'
      );


    /* ========================================
       7. SHEET ABSENSI
    ======================================== */

    const ss =
      getSpreadsheet();


    const sheet =
      ss.getSheetByName(
        CONFIG.SHEET_ABSENSI
      );


    if (!sheet) {

      throw new Error(
        'Sheet ABSENSI tidak ditemukan.'
      );

    }


    /* ========================================
       8. SIMPAN ABSENSI
    ======================================== */

    sheet.appendRow([

      now,

      tanggal,

      jam,

      student.studentId,

      student.nama,

      student.kelas,

      attendanceStatus,

      'Masuk',

      'QR',

      'Petugas'

    ]);


    /* ========================================
       9. LOG
    ======================================== */

    writeLog(
      studentId,
      'SCAN',
      'BERHASIL',
      attendanceStatus
    );


    /* ========================================
       10. RESPONSE
    ======================================== */

    return {

      success: true,

      status:
        'SUCCESS',

      attendanceStatus:
        attendanceStatus,

      message:
        'Absensi berhasil dicatat.',

      student:
        student,

      attendance: {

        tanggal:
          tanggal,

        jam:
          jam,

        status:
          attendanceStatus

      }

    };

  }


  catch (error) {

    console.error(
      'PROCESS ATTENDANCE ERROR:',
      error
    );


    try {

      writeLog(
        studentId,
        'SCAN',
        'ERROR',
        error.message ||
          'Terjadi kesalahan.'
      );

    }

    catch (logError) {

      console.error(
        'LOG ERROR:',
        logError
      );

    }


    return {

      success: false,

      status:
        'ERROR',

      message:
        error.message ||
        'Terjadi kesalahan server.',

      student:
        student

    };

  }


  finally {

    try {

      lock.releaseLock();

    }

    catch (error) {

      console.error(
        'RELEASE LOCK ERROR:',
        error
      );

    }

  }

}


/* =====================================================
   REKAP ABSENSI HARI INI
===================================================== */

/**
 * Mengambil data absensi hari ini.
 *
 * Sumber tanggal:
 * kolom A = TIMESTAMP
 *
 * Struktur ABSENSI:
 *
 * A TIMESTAMP
 * B TANGGAL
 * C JAM
 * D STUDENT_ID
 * E NAMA
 * F KELAS
 * G STATUS
 * H JENIS
 * I METODE
 * J PETUGAS
 */

function getTodaySummary() {

  const ss =
    getSpreadsheet();


  const sheet =
    ss.getSheetByName(
      CONFIG.SHEET_ABSENSI
    );


  if (!sheet) {

    throw new Error(
      'Sheet ABSENSI tidak ditemukan.'
    );

  }


  const lastRow =
    sheet.getLastRow();


  /* ==========================================
     BELUM ADA ABSENSI
  ========================================== */

  if (
    lastRow < 2
  ) {

    return {

      success: true,

      total: 0,

      hadir: 0,

      terlambat: 0,

      sudahAbsen: 0,

      error: 0,

      tanggal:
        Utilities.formatDate(
          new Date(),
          Session.getScriptTimeZone() ||
            'Asia/Jakarta',
          'yyyy-MM-dd'
        )

    };

  }


  /* ==========================================
     AMBIL DATA A:J
  ========================================== */

  const data =
    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        10
      )
      .getValues();


  const timezone =
    Session.getScriptTimeZone() ||
    'Asia/Jakarta';


  const now =
    new Date();


  const today =
    Utilities.formatDate(
      now,
      timezone,
      'yyyy-MM-dd'
    );


  /* ==========================================
     COUNTER
  ========================================== */

  let hadir = 0;

  let terlambat = 0;

  let error = 0;


  /*
   * STUDENT ID unik
   */
  const studentIds =
    new Set();


  /* ==========================================
     LOOP DATA
  ========================================== */

  data.forEach(
    function(row) {

      /*
       * A = TIMESTAMP
       */
      const timestamp =
        row[0];


      /*
       * D = STUDENT_ID
       */
      const studentId =
        String(
          row[3] || ''
        ).trim();


      /*
       * G = STATUS
       */
      const status =
        String(
          row[6] || ''
        ).trim();


      /*
       * Tanpa timestamp,
       * abaikan baris.
       */

      if (!timestamp) {

        return;

      }


      /* ========================================
         CEK TANGGAL
      ======================================== */

      let rowDate;


      try {

        rowDate =
          Utilities.formatDate(
            new Date(timestamp),
            timezone,
            'yyyy-MM-dd'
          );

      }

      catch (errorDate) {

        console.error(
          'Tanggal tidak valid:',
          timestamp
        );

        return;

      }


      /*
       * Bukan hari ini
       */

      if (
        rowDate !== today
      ) {

        return;

      }


      /* ========================================
         ID SISWA
      ======================================== */

      if (
        studentId
      ) {

        studentIds.add(
          studentId
        );

      }


      /* ========================================
         STATUS
      ======================================== */

      const statusLower =
        status.toLowerCase();


      if (
        statusLower ===
        'hadir'
      ) {

        hadir++;

      }

      else if (
        statusLower.includes(
          'terlambat'
        )
      ) {

        terlambat++;

      }

      else {

        error++;

      }

    }
  );


  /* ==========================================
     SUDAH ABSEN
  ========================================== */

  const sudahAbsen =
    studentIds.size;


  /*
   * TOTAL = siswa unik yang
   * sudah melakukan absensi
   */

  const total =
    sudahAbsen;


  /* ==========================================
     RETURN
  ========================================== */

  return {

    success: true,

    total:
      total,

    hadir:
      hadir,

    terlambat:
      terlambat,

    sudahAbsen:
      sudahAbsen,

    error:
      error,

    tanggal:
      today,

    serverTime:
      Utilities.formatDate(
        now,
        timezone,
        'HH:mm:ss'
      )

  };

}


/* =====================================================
   TEST
===================================================== */

/**
 * TEST SISWA VALID
 */

function testAttendance() {

  const result =
    processAttendance(
      'BU-2026-0001'
    );


  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

}


/**
 * TEST ID TIDAK TERDAFTAR
 */

function testUnknownStudent() {

  const result =
    processAttendance(
      'BU-9999-9999'
    );


  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

}


/**
 * TEST SISWA TIDAK AKTIF
 */

function testInactiveStudent() {

  const result =
    processAttendance(
      'BU-2026-0002'
    );


  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

}


/**
 * TEST STATUS WAKTU
 */

function testTimeStatus() {

  const status =
    determineAttendanceStatus();


  Logger.log(
    'Status saat ini: ' +
    status
  );

}


/**
 * TEST PERHITUNGAN WAKTU
 */

function testTimeCalculation() {

  const testTimes = [

    '06:30',

    '06:59',

    '07:00',

    '07:10',

    '07:15',

    '07:16',

    '12:00',

    '18:00'

  ];


  const batas =
    timeToMinutes(
      '07:15'
    );


  testTimes.forEach(
    function(time) {

      const minutes =
        timeToMinutes(
          time
        );


      const status =
        minutes <= batas
          ? 'Hadir'
          : 'Terlambat';


      Logger.log(
        time +
        ' → ' +
        status
      );

    }
  );

}


/**
 * TEST API ABSENSI
 */

function testApiAttendance() {

  const fakeRequest = {

    postData: {

      contents:
        JSON.stringify({

          action:
            'attendance',

          studentId:
            'BU-2026-0005'

        })

    }

  };


  const response =
    doPost(
      fakeRequest
    );


  Logger.log(
    response.getContent()
  );

}


/**
 * TEST REKAP HARI INI
 */

function testTodaySummary() {

  const result =
    getTodaySummary();


  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

}

/**
 * =====================================================
 * V5.2 - REKAP ABSENSI HARIAN
 * =====================================================
 *
 * Fungsi:
 * - Mengambil daftar absensi hari ini
 * - Urutan berdasarkan TIMESTAMP paling awal
 * - Siswa pertama  = 🥇
 * - Siswa kedua    = 🥈
 * - Siswa ketiga   = 🥉
 * - Siswa berikutnya = nomor biasa
 *
 * Tidak mengubah struktur Sheet ABSENSI.
 *
 * Struktur ABSENSI:
 * A = TIMESTAMP
 * B = TANGGAL
 * C = JAM
 * D = STUDENT_ID
 * E = NAMA
 * F = KELAS
 * G = STATUS
 * H = JENIS
 * I = METODE
 * J = PETUGAS
 * =====================================================
 */

function getTodayAttendanceList() {

  try {

    const ss =
      SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
      ss.getSheetByName(
        CONFIG.SHEET_ABSENSI
      );


    // ==========================================
    // CEK SHEET
    // ==========================================

    if (!sheet) {

      throw new Error(
        'Sheet ABSENSI tidak ditemukan.'
      );

    }


    const lastRow =
      sheet.getLastRow();


    // ==========================================
    // JIKA BELUM ADA DATA
    // ==========================================

    if (lastRow < 2) {

      return {

        success: true,

        tanggal: getTodayDateString(),

        total: 0,

        data: []

      };

    }


    // ==========================================
    // AMBIL DATA A:J
    // ==========================================

    const data =
      sheet
        .getRange(
          2,
          1,
          lastRow - 1,
          10
        )
        .getValues();


    // ==========================================
    // TIMEZONE
    // ==========================================

    const timezone =
      Session.getScriptTimeZone() ||
      'Asia/Jakarta';


    // ==========================================
    // TANGGAL HARI INI
    // ==========================================

    const today =
      Utilities.formatDate(
        new Date(),
        timezone,
        'yyyy-MM-dd'
      );


    // ==========================================
    // FILTER ABSENSI HARI INI
    // ==========================================

    const attendanceToday =
      [];


    data.forEach(function(row) {

      /*
       * Struktur:
       *
       * A = TIMESTAMP
       * B = TANGGAL
       * C = JAM
       * D = STUDENT_ID
       * E = NAMA
       * F = KELAS
       * G = STATUS
       * H = JENIS
       * I = METODE
       * J = PETUGAS
       */

      const timestamp =
        row[0];

      const studentId =
        String(
          row[3] || ''
        ).trim();


      const nama =
        String(
          row[4] || ''
        ).trim();


      const kelas =
        String(
          row[5] || ''
        ).trim();


      const status =
        String(
          row[6] || ''
        ).trim();


      // ========================================
      // VALIDASI TIMESTAMP
      // ========================================

      if (!timestamp) {
        return;
      }


      // ========================================
      // VALIDASI STUDENT ID
      // ========================================

      if (!studentId) {
        return;
      }


      // ========================================
      // KONVERSI TIMESTAMP KE TANGGAL
      // ========================================

      let dateString = '';


      try {

        dateString =
          Utilities.formatDate(
            new Date(timestamp),
            timezone,
            'yyyy-MM-dd'
          );

      }

      catch (error) {

        return;

      }


      // ========================================
      // HANYA DATA HARI INI
      // ========================================

      if (
        dateString !== today
      ) {

        return;

      }


      // ========================================
      // JAM ABSENSI
      // ========================================

      const jam =
        Utilities.formatDate(
          new Date(timestamp),
          timezone,
          'HH:mm:ss'
        );


      // ========================================
      // MASUKKAN KE ARRAY
      // ========================================

      attendanceToday.push({

        timestamp:
          new Date(timestamp)
            .getTime(),

        studentId:
          studentId,

        nama:
          nama,

        kelas:
          kelas,

        status:
          status,

        jam:
          jam

      });

    });


    // ==========================================
    // URUTKAN BERDASARKAN TIMESTAMP
    // PALING AWAL → PALING AKHIR
    // ==========================================

    attendanceToday.sort(
      function(a, b) {

        return (
          a.timestamp -
          b.timestamp
        );

      }
    );


    // ==========================================
    // TAMBAHKAN NOMOR URUTAN
    // ==========================================

    const result =
      attendanceToday.map(
        function(item, index) {

          const nomor =
            index + 1;


          let urutan;


          // ======================================
          // TIGA SISWA PERTAMA
          // ======================================

          if (
            nomor === 1
          ) {

            urutan = '🥇';

          }

          else if (
            nomor === 2
          ) {

            urutan = '🥈';

          }

          else if (
            nomor === 3
          ) {

            urutan = '🥉';

          }

          else {

            urutan =
              String(nomor);

          }


          return {

            nomor:
              nomor,

            urutan:
              urutan,

            jam:
              item.jam,

            studentId:
              item.studentId,

            nama:
              item.nama,

            kelas:
              item.kelas,

            status:
              item.status

          };

        }
      );


    // ==========================================
    // RESPONSE
    // ==========================================

    return {

      success:
        true,

      tanggal:
        today,

      total:
        result.length,

      data:
        result

    };

  }


  catch (error) {

    console.error(
      'GET TODAY ATTENDANCE ERROR:',
      error
    );


    return {

      success:
        false,

      tanggal:
        getTodayDateString(),

      total:
        0,

      data:
        [],

      message:
        error.message ||
        'Gagal mengambil data absensi hari ini.'

    };

  }

}


/**
 * =====================================================
 * HELPER
 * Mendapatkan tanggal hari ini
 * =====================================================
 */

function getTodayDateString() {

  const timezone =
    Session.getScriptTimeZone() ||
    'Asia/Jakarta';


  return Utilities.formatDate(
    new Date(),
    timezone,
    'yyyy-MM-dd'
  );

}

/**
 * =====================================================
 * TEST REKAP ABSENSI HARIAN
 * =====================================================
 */

function testTodayAttendanceList() {

  const result =
    getTodayAttendanceList();


  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

}