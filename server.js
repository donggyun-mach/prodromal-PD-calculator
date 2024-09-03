const express = require('express');
const bodyParser = require('body-parser');
const initializeDatabase = require('./db');
const exportSurveyToExcel = require('./exportSurvey');
let db;
initializeDatabase().then(connection => {
    db = connection;
    console.log('Database initialized successfully');
}).catch(error => {
    console.error('Failed to initialize database:', error);
});


const path = require('path');
const moment = require('moment');
const cors = require('cors');
const app = express();
const PORT = 3000;


app.use(cors());

// Middleware
app.use(bodyParser.json());
app.use(express.static('public'));


// Serve the main.html file
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/main.html');
});



// Endpoint to handle start calculation

app.post('/start-Questionnaire/q/:qnum', async (req, res) => {
    const { name, age, sex, id,underlyingConditions } = req.body;
    const qnum = parseInt(req.params.qnum);
    console.log(`Received request to start questionnaire with qnum: ${qnum}, name: ${name}, age: ${age}, sex: ${sex}, underlyingConditions: ${underlyingConditions},id :${id}`);
    try {

        let surveyId;
        if (qnum === 0) {
          // Combine underlyingConditions array with udelse
          let underlyingString = Array.isArray(underlyingConditions) ? underlyingConditions.join(',') : underlyingConditions || '';
  
            const [result] = await db.execute(
                'INSERT INTO survey_responses (name, age, sex, underlying, id) VALUES (?, ?, ?, ?, ?)', 
                 [name, age, sex, underlyingString, id]
             );
             console.log('Inserted new survey response:', result);
            surveyId = id;
        } else {
            surveyId = id;
        }
         console.log('index:', req.params.qnum);
        const index = req.params.qnum==0 ? 1 : req.params.qnum; 
        console.log('index:', index);
        // Get the question based on question_number
        const [rows] = await db.execute(
            'SELECT question_number, question_text, choice_yes_weight, choice_no_weight, choice_notsure_weight FROM questions WHERE question_number = ?', 
            [index]
        );
         console.log('SELECT new survey response:', rows[0]);
        const question = rows[0];

        // Return the survey ID, first question, and choices
        res.json({ 
            surveyId, 
            qnum: question.question_number, 
            question: question.question_text, 
            choices: { 네: question.choice_yes_weight, 아니오: question.choice_no_weight, 모름: question.choice_notsure_weight }
        });
     //   displayQuestion(data);
    } catch (error) {
        console.error('Error starting survey and getting question:', error);
        res.status(500).json({ error: 'Failed to start survey and get first question' });
    }
});


// Save Response and Get Next Question
app.post('/nextPage', async (req, res) => {
    const { surveyId, qnum, choices } = req.body;
    try {
        // Save answers for regular questions
        if (qnum < 21) {
            const currentQuestionChoices = choices.filter(choice => choice.questionNumber === qnum);
            for (let choice of currentQuestionChoices) {
                await db.execute('INSERT INTO survey_answers (survey_id, question_number, choice, weight) VALUES (?, ?, ?, ?)', 
                    [surveyId, choice.questionNumber, choice.choice, choice.weight]);
            }
        }
        const nextQnum = qnum + 1;

        if (nextQnum === 21) {
            // Fetch UPDRS questions
            const [updrsQuestions] = await db.execute('SELECT question_index, main_q_text, choice_yes_weight FROM questions_updrs');

            res.json({ 
                qnum: nextQnum,
                question: "느끼는 증상들을 모두 고르세요",
                updrsQuestions: updrsQuestions,
                isLastQuestion: true
            });
        } else if (nextQnum > 21) {
            // Save UPDRS answers
            if (choices && choices.length > 0) {
                // All choices at this point are for question 21 (UPDRS)
                const updrsChoices = choices.filter(choice => choice.questionNumber === 21);                
                const choiceIndexes = updrsChoices.map(choice => choice.choice).join(',');
                let totalWeight = updrsChoices.reduce((sum, choice) => sum + parseFloat(choice.weight), 0);
                const actual_weight = totalWeight < 2 ? 0.5 : 2;

                await db.execute('INSERT INTO answers_updrs (survey_id, choices, weights, actual_weight) VALUES (?, ?, ?, ?)', 
                    [surveyId, choiceIndexes, totalWeight, actual_weight]);
            }

            res.json({ completed: true, message: 'Survey completed' });
        } else {
            // Fetch next regular question
            const [nextQuestionRows] = await db.execute('SELECT question_number, question_text, choice_yes_weight, choice_no_weight, choice_notsure_weight FROM questions WHERE question_number = ?', [nextQnum]);

            if (nextQuestionRows.length === 0) {
                return res.json({ completed: true, message: 'Survey completed' });
            }

            const nextQuestion = nextQuestionRows[0];
            res.json({ 
                qnum: nextQnum,
                question: nextQuestion.question_text,
                choices: { 
                    네: nextQuestion.choice_yes_weight, 
                    아니오: nextQuestion.choice_no_weight, 
                    모름: nextQuestion.choice_notsure_weight 
                },
                isLastQuestion: nextQnum === 20
            });
        }
    } catch (error) {
        console.error('Error processing next page:', error);
        res.status(500).json({ error: 'Failed to process next page' });
    }
});


// Result Page: Calculate Total LR and Show Result
app.get('/resultsPage', async (req, res) => {
    const { surveyId } = req.query;

    try {
        // Calculate total LR for the survey from survey_answers
        const [rows] = await db.execute('SELECT EXP(SUM(LOG(weight))) as totalLR FROM survey_answers WHERE survey_id = ?', [surveyId]);
        let totalLR = rows[0].totalLR;
        console.log('totalLR:', totalLR);
        // Get the actual_weight from answers_updrs
        const [updrsRows] = await db.execute('SELECT actual_weight FROM answers_updrs WHERE survey_id = ?', [surveyId]);

        // Multiply actual_weight with totalLR
        totalLR *= updrsRows[0].actual_weight;

        // Determine the thresholdLR based on the age of the participant
        const [surveyInfo] = await db.execute('SELECT age FROM survey_responses WHERE id = ?', [surveyId]);
        const age = surveyInfo[0].age;
        const thresholdLR = determineThresholdLR(age);

        console.log('updrsRows:', [updrsRows]);
        console.log('surveyInfo:', [surveyInfo]);
        // Determine if the participant is "in danger" or "safe"
        const resultMessage = totalLR >= thresholdLR ? '정밀검사가 필요합니다' : '수치 상 안전할 가능성이 높습니다';

        console.log('Sending response:', { totalLR, resultMessage });
        // Send the result as a JSON response
        res.json({ totalLR, resultMessage });
    } catch (error) {
        console.error('Error calculating total LR:', error);
        res.status(500).json({ error: 'Failed to calculate total LR' });
    }
});

function determineThresholdLR(age) {
    // Implement your logic to determine the thresholdLR based on age
    // For example:
    if (age < 54) {
        return 1000;
    } else if (age>= 55 && age< 59) {
        return 515;
    } else if (age >= 60 && age <= 64) {
        return 300;
    } else if (age >= 65 && age <= 69) {
        return 180;
    } else if (age >= 70 && age <= 74) {
        return 155;
    } else {
        return 95;
    }}

    app.get('/export-survey/:surveyId', async (req, res) => {
        const surveyId = req.params.surveyId;
        console.log('Received surveyId:', surveyId);
        if (!surveyId) {
            return res.status(400).json({ error: 'Invalid survey ID' });
        }

        try {
            const excelBuffer = await exportSurveyToExcel(db, surveyId);
    
            if (!excelBuffer) {
                throw new Error('Failed to generate Excel file');
            }
    
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=survey_${surveyId}_${Date.now()}.xlsx`);
            res.send(excelBuffer);
        } catch (error) {
            console.error('Error exporting survey to Excel:', error);
            res.status(500).json({ error: 'Failed to export survey', details: error.message });
        }
    });


app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});