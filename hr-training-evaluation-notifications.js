import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import XLSX from 'xlsx';

dotenv.config();

// HR Training Evaluation Configuration
const HR_TRAINING_CONFIG = {
  excelFilePath: 'C:\\cron-temp-files\\hr-trainings.xlsx',
  evaluationDeadlineColumn: process.env.HR_TRAINING_DEADLINE_COLUMN || 'Z', // Column Z contains the deadline date
  supervisorNameColumn: process.env.HR_TRAINING_NAME_COLUMN || 'W', // Column W contains supervisor names (surname firstname)
  trainingNameColumn: process.env.HR_TRAINING_TRAINING_NAME_COLUMN || 'C', // Column C contains training names
  traineeNameColumn: process.env.HR_TRAINING_TRAINEE_NAME_COLUMN || 'J', // Column J contains trainee names (surname firstname)
  sheetName: process.env.HR_TRAINING_SHEET_NAME || null, // null means use first sheet
  evaluationResultColumn:
    process.env.HR_TRAINING_EVALUATION_RESULT_COLUMN || 'AC', // Column AC contains evaluation results
};

/**
 * Remove Polish characters and convert to basic Latin characters
 */
function removePlPolishCharacters(text) {
  const polishToLatin = {
    ą: 'a',
    ć: 'c',
    ę: 'e',
    ł: 'l',
    ń: 'n',
    ó: 'o',
    ś: 's',
    ź: 'z',
    ż: 'z',
    Ą: 'A',
    Ć: 'C',
    Ę: 'E',
    Ł: 'L',
    Ń: 'N',
    Ó: 'O',
    Ś: 'S',
    Ź: 'Z',
    Ż: 'Z',
  };

  return text.replace(
    /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g,
    (char) => polishToLatin[char] || char
  );
}

/**
 * Convert "Surname Firstname" to "firstname.surname@bruss-group.com"
 */
function convertNameToEmail(fullName) {
  if (!fullName || typeof fullName !== 'string') {
    return null;
  }

  // Remove extra spaces and split by space
  const nameParts = fullName.trim().split(/\s+/);

  if (nameParts.length < 2) {
    console.warn(
      `Invalid name format: "${fullName}" - expected "Surname Firstname"`
    );
    return null;
  }

  // First part is surname, second part is firstname
  const surname = nameParts[0];
  const firstname = nameParts[1];

  // Remove Polish characters and convert to lowercase
  const cleanSurname = removePlPolishCharacters(surname).toLowerCase();
  const cleanFirstname = removePlPolishCharacters(firstname).toLowerCase();

  // Create email address
  return `${cleanFirstname}.${cleanSurname}@bruss-group.com`;
}

/**
 * Helper function to create Polish email content for HR training evaluation reminders
 */
function createHrTrainingEvaluationEmailContent(
  supervisorName,
  trainingName,
  evaluationDeadline
) {
  const formattedDate = new Date(evaluationDeadline).toLocaleDateString(
    'pl-PL'
  );
  const firstName = supervisorName
    ? supervisorName.split(' ')[1] || supervisorName
    : '';

  return `
    <div>
      <p>Dzień dobry${firstName ? ` ${firstName}` : ''},</p>
      <p>W dniu <strong>${formattedDate}</strong> mija termin wymaganego dokonania oceny efektywności zrealizowanych szkoleń w Twoim zespole.</p>
      <p><strong>Szkolenie:</strong> ${trainingName}</p>
      <p>
        Proszę o pilne dokonanie oceny efektywności tych szkoleń w dostępnym pliku:
        <strong>W:\\HrManagement\\1_Szkolenia\\2_PHR-7.2.01-01_PLAN SZKOLEŃ</strong>.
      </p>
      <p>Pomoże nam to w przyszłości w podjęciu decyzji dotyczących szkoleń w podobnych obszarach lub tematyce.</p>
      <p>W razie pytań lub wątpliwości, skontaktuj się z działem HR.<br/>Z góry bardzo dziękujemy za rzetelność i terminowość.</p>
      <p style="margin-top:2em;">Z poważaniem,<br/>Dział HR</p>
    </div>`;
}

/**
 * Get today's date for checking passed training evaluation deadlines
 */
function getTodaysDate() {
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Set to beginning of day
  return today;
}

/**
 * Parse date from Excel cell value for training evaluation deadlines
 */
function parseTrainingEvaluationDate(cellValue) {
  if (!cellValue) return null;

  // If it's already a Date object
  if (cellValue instanceof Date) {
    return cellValue;
  }

  // If it's an Excel serial number
  if (typeof cellValue === 'number') {
    // Excel serial date conversion
    const excelEpoch = new Date(1900, 0, 1);
    const days = cellValue - 2; // Excel has a leap year bug for 1900
    return new Date(excelEpoch.getTime() + days * 24 * 60 * 60 * 1000);
  }

  // If it's a string, try to parse it
  if (typeof cellValue === 'string') {
    const parsed = new Date(cellValue);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

/**
 * Convert Excel column letter to index (A=0, B=1, ..., Z=25, AA=26, etc.)
 */
function excelColumnToIndex(letter) {
  let result = 0;
  for (let i = 0; i < letter.length; i++) {
    result = result * 26 + (letter.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
  }
  return result - 1;
}

/**
 * Send HR training evaluation reminder email notification
 */
export async function sendHrTrainingEvaluationNotification(
  supervisorEmail,
  supervisorName,
  trainingName,
  evaluationDeadline,
  excelFilePath
) {
  try {
    const subject = `Przypomnienie HR: Ocena efektywności szkoleń - ${trainingName}`;
    const html = createHrTrainingEvaluationEmailContent(
      supervisorName,
      trainingName,
      evaluationDeadline,
      excelFilePath
    );

    if (process.env.NODE_ENV === 'development') {
      console.log('[DEVELOPMENT] Would send email with:');
      console.log('To:', supervisorEmail);
      console.log('Subject:', subject);
      console.log('HTML:', html);
    }
    if (process.env.NODE_ENV === 'development') {
      console.log(
        `[DEV] Sending email to: ${supervisorEmail} | Subject: ${subject}`
      );
    }

    await axios.post(`${process.env.API_URL}/mailer`, {
      to: supervisorEmail,
      subject,
      html,
    });

    return { success: true, email: supervisorEmail };
  } catch (error) {
    console.error(
      `Error sending HR training evaluation email to ${supervisorEmail}:`,
      error.message
    );
    return { success: false, email: supervisorEmail, error: error.message };
  }
}

/**
 * Send an email to HR for errors or summary notifications
 */
async function sendHrErrorOrSummaryEmail(subject, html) {
  try {
    // Send to both HR department and Adrian Antosiak
    const recipients = [
      'HR.mrg@bruss-group.com',
      'adrian.antosiak@bruss-group.com',
    ];

    await axios.post(`${process.env.API_URL}/mailer`, {
      to: recipients.join(','), // Multiple recipients separated by comma
      subject,
      html,
    });
  } catch (error) {
    console.error(`Error sending HR error/summary email:`, error.message);
  }
}

/**
 * Main function to process HR training evaluation Excel file and send deadline notifications
 */
export async function sendHrTrainingEvaluationNotifications() {
  const startTime = new Date();
  console.log(
    `Starting HR training evaluation deadline notifications check at ${startTime.toLocaleString()}`
  );

  try {
    // Check if HR training Excel file exists
    if (!fs.existsSync(HR_TRAINING_CONFIG.excelFilePath)) {
      console.error(
        `HR training Excel file not found: ${HR_TRAINING_CONFIG.excelFilePath}`
      );
      // Send notification to HR department (Polish)
      await sendHrErrorOrSummaryEmail(
        'Brak pliku do oceny szkoleń HR',
        `<p>Nie odnaleziono pliku z oceną szkoleń HR pod wskazaną ścieżką:<br/><strong>${HR_TRAINING_CONFIG.excelFilePath}</strong></p>`
      );
      return;
    }

    // Read the HR training Excel file
    const workbook = XLSX.readFile(HR_TRAINING_CONFIG.excelFilePath);
    const sheetName = HR_TRAINING_CONFIG.sheetName || workbook.SheetNames[0];

    if (!workbook.Sheets[sheetName]) {
      console.error(`HR training sheet "${sheetName}" not found in Excel file`);
      return;
    }

    const worksheet = workbook.Sheets[sheetName];

    // Get the range of the HR training worksheet
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');

    // Convert HR training column letters to indices
    const evaluationDeadlineColIndex = excelColumnToIndex(
      HR_TRAINING_CONFIG.evaluationDeadlineColumn
    ); // Column Z
    const supervisorNameColIndex = excelColumnToIndex(
      HR_TRAINING_CONFIG.supervisorNameColumn
    ); // Column W
    const trainingNameColIndex = excelColumnToIndex(
      HR_TRAINING_CONFIG.trainingNameColumn
    ); // Column C
    const traineeNameColIndex = excelColumnToIndex(
      HR_TRAINING_CONFIG.traineeNameColumn
    ); // Column J
    const evaluationResultColIndex = excelColumnToIndex(
      HR_TRAINING_CONFIG.evaluationResultColumn
    ); // Column AC

    // Get today's date for deadline checking
    const todaysDate = getTodaysDate();
    console.log(
      `Checking for HR training evaluation deadlines on or before: ${todaysDate.toLocaleDateString(
        'pl-PL'
      )}`
    );

    let processedRows = 0;
    let hrNotificationsSent = 0;
    let errors = [];
    let invalidSupervisorRows = [];
    let skippedEvaluations = 0;

    // Process each row in the HR training file (start from row 8 to skip headers and functional rows 1-7)
    for (let row = 7; row <= range.e.r; row++) {
      processedRows++;

      // Get HR training cell values
      const deadlineCellAddress = XLSX.utils.encode_cell({
        r: row,
        c: evaluationDeadlineColIndex,
      });
      const nameCellAddress = XLSX.utils.encode_cell({
        r: row,
        c: supervisorNameColIndex,
      });
      const trainingCellAddress = XLSX.utils.encode_cell({
        r: row,
        c: trainingNameColIndex,
      });
      const traineeCellAddress = XLSX.utils.encode_cell({
        r: row,
        c: traineeNameColIndex,
      });
      const evaluationResultCellAddress = XLSX.utils.encode_cell({
        r: row,
        c: evaluationResultColIndex,
      });

      const deadlineValue = worksheet[deadlineCellAddress]?.v;
      const nameValue = worksheet[nameCellAddress]?.v;
      const trainingValue = worksheet[trainingCellAddress]?.v;
      const traineeValue = worksheet[traineeCellAddress]?.v;
      const evaluationResultValue = worksheet[evaluationResultCellAddress]?.v;

      // Skip rows without trainee name (column J)
      if (!traineeValue || typeof traineeValue !== 'string') {
        continue;
      }

      // Skip rows without supervisor name or training name
      if (!nameValue || typeof nameValue !== 'string') {
        invalidSupervisorRows.push({
          row: row + 1,
          nameValue,
          reason: 'Brak lub nieprawidłowe dane przełożonego',
        });
        continue;
      }

      // Skip if evaluation result exists in column AC
      if (
        evaluationResultValue !== undefined &&
        evaluationResultValue !== null &&
        evaluationResultValue !== ''
      ) {
        skippedEvaluations = (skippedEvaluations || 0) + 1;
        continue;
      }

      // Parse and validate HR training evaluation deadline
      const parsedDeadline = parseTrainingEvaluationDate(deadlineValue);
      if (!parsedDeadline) {
        continue;
      }

      // Check if HR training evaluation deadline has passed (date is today or earlier)
      if (parsedDeadline <= todaysDate) {
        const supervisorEmail = convertNameToEmail(nameValue);
        const result = await sendHrTrainingEvaluationNotification(
          supervisorEmail,
          nameValue,
          trainingValue,
          parsedDeadline,
          HR_TRAINING_CONFIG.excelFilePath
        );

        if (result.success) {
          hrNotificationsSent++;
        } else {
          errors.push(result);
        }

        // Add a small delay between HR training emails to avoid overwhelming the email service
        // Add a 3 second delay between HR training emails to avoid overwhelming the email service
        await new Promise((resolve) => setTimeout(resolve, 3000)); // 3 second delay
      }
    }

    // Log HR training evaluation summary
    const endTime = new Date();
    const duration = Math.round((endTime - startTime) / 1000);

    console.log(
      `HR training evaluation notifications completed at ${endTime.toLocaleString()}`
    );
    console.log(
      `Duration: ${duration}s | Processed: ${processedRows} rows | HR notifications sent: ${hrNotificationsSent}`
    );

    if (errors.length > 0) {
      console.log(
        `HR training evaluation errors encountered: ${errors.length}`
      );
      errors.forEach((error) => {
        console.error(
          `Failed to send HR training notification to ${error.email}: ${error.error}`
        );
      });
    }

    // Send summary email to HR (Polish)
    const summaryHtml = `
      <h3>Podsumowanie powiadomień o ocenie szkoleń HR</h3>
      <p><strong>Przetworzone wiersze:</strong> ${processedRows}</p>
      <p><strong>Wysłane powiadomienia:</strong> ${hrNotificationsSent}</p>
      <p><strong>Błędy (brakujące/nieprawidłowe dane przełożonych):</strong> ${
        invalidSupervisorRows.length
      }</p>
      ${
        invalidSupervisorRows.length > 0
          ? `<ul>${invalidSupervisorRows
              .map(
                (e) =>
                  `<li>Wiersz ${e.row}: ${e.nameValue || '(puste)'} - ${
                    e.reason
                  }</li>`
              )
              .join('')}</ul>`
          : ''
      }
      <p><strong>Wykonane oceny bez aktualizacji daty:</strong> ${skippedEvaluations}</p>
      <p><strong>Inne błędy powiadomień:</strong> ${errors.length}</p>
      ${
        errors.length > 0
          ? `<ul>${errors
              .map((e) => `<li>${e.email}: ${e.error}</li>`)
              .join('')}</ul>`
          : ''
      }
      <p>Czas trwania: ${duration}s</p>
      <p>Uruchomienie skryptu: ${startTime.toLocaleString(
        'pl-PL'
      )} - ${endTime.toLocaleString('pl-PL')}</p>
    `;
    await sendHrErrorOrSummaryEmail(
      'Podsumowanie powiadomień o ocenie szkoleń HR',
      summaryHtml
    );
  } catch (error) {
    console.error('Error in sendHrTrainingEvaluationNotifications:', error);
  }
}
