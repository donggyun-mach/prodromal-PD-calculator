const xlsx = require('xlsx');

async function exportSurveyToExcel(db, surveyId) {
    if (!surveyId) {
        throw new Error('Invalid survey ID');
    }

async function exportSurveyToExcel(db, surveyId) {
    try {
        console.log('Starting export for surveyId:', surveyId);
        // Fetch data from different tables
        const [surveyResponses] = await db.execute('SELECT * FROM survey_responses WHERE id = ?', [surveyId]);
        console.log('Survey Responses:', surveyResponses);

        const [surveyAnswers] = await db.execute('SELECT * FROM survey_answers WHERE survey_id = ?', [surveyId]);
        console.log('Survey Answers:', surveyAnswers);

        const [questions] = await db.execute('SELECT * FROM questions');

        const [questionsUpdrs] = await db.execute('SELECT * FROM questions_updrs');

        const [answersUpdrs] = await db.execute('SELECT * FROM answers_updrs WHERE survey_id = ?', [surveyId]);
        console.log('UPDRS Answers:', answersUpdrs);

        // Calculate totalLR and resultMessage
        const [lrRows] = await db.execute('SELECT EXP(SUM(LOG(weight))) as totalLR FROM survey_answers WHERE survey_id = ?', [surveyId]);
        let totalLR = lrRows[0]?.totalLR || 1; // Default to 1 if no answers
        console.log('Total LR before UPDRS:', totalLR);

        if (answersUpdrs.length > 0 && answersUpdrs[0].actual_weight !== undefined) {
            totalLR *= answersUpdrs[0].actual_weight;
            console.log('UPDRS actual_weight:', answersUpdrs[0].actual_weight);
        } else {
            console.log('No UPDRS data found for surveyId:', surveyId);
        }

        console.log('Final Total LR:', totalLR);

        const age = surveyResponses[0]?.age || 0; // Default to 0 if age not found
        const thresholdLR = determineThresholdLR(age);
        const resultMessage = totalLR >= thresholdLR ? '정밀검사가 필요합니다' : '수치 상 안전할 가능성이 높습니다';

        console.log('Age:', age, 'Threshold LR:', thresholdLR, 'Result Message:', resultMessage);

        // Create workbook and worksheets
        const workbook = xlsx.utils.book_new();

        // Helper function to create a worksheet with a default message if data is empty
        function createWorksheet(data, sheetName) {
            if (data.length === 0) {
                return xlsx.utils.json_to_sheet([{ message: `No data available for ${sheetName}` }]);
            }
            return xlsx.utils.json_to_sheet(data);
        }

        xlsx.utils.book_append_sheet(workbook, createWorksheet(surveyResponses, 'Survey Responses'), 'Survey Responses');
        xlsx.utils.book_append_sheet(workbook, createWorksheet(surveyAnswers, 'Survey Answers'), 'Survey Answers');
        xlsx.utils.book_append_sheet(workbook, createWorksheet(questions, 'Questions'), 'Questions');
        xlsx.utils.book_append_sheet(workbook, createWorksheet(questionsUpdrs, 'UPDRS Questions'), 'UPDRS Questions');
        xlsx.utils.book_append_sheet(workbook, createWorksheet(answersUpdrs, 'UPDRS Answers'), 'UPDRS Answers');
        xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([{ totalLR, resultMessage, age, thresholdLR }]), 'Final Results');
        const finalResults = [{
            totalLR,
            resultMessage,
            age,
            thresholdLR,
            surveyId,
            dataAvailable: surveyResponses.length > 0 ? 'Yes' : 'No'
        }];
        xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(finalResults), 'Final Results');

        // Convert workbook to buffer
        const excelBuffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        return excelBuffer;
    } catch (error) {
        console.error('Error exporting survey to Excel:', error);
        throw error;
    }
}}

function determineThresholdLR(age) {
    if (age < 54) {
        return 1000;
    } else if (age >= 55 && age < 59) {
        return 515;
    } else if (age >= 60 && age <= 64) {
        return 300;
    } else if (age >= 65 && age <= 69) {
        return 180;
    } else if (age >= 70 && age <= 74) {
        return 155;
    } else {
        return 95;
    }
}

module.exports = exportSurveyToExcel;