import React, { useState, useEffect, useRef } from 'react';
import initSqlJs from 'sql.js';
import Papa from 'papaparse';
import Chart from 'chart.js/auto';
import './App.css'; // Import the new CSS file

// Define the expected schema for the tables based on your CSVs
const TABLE_SCHEMAS = {
    'product_ad_sales_metrics': `
        CREATE TABLE IF NOT EXISTS product_ad_sales_metrics (
            date TEXT,
            item_id TEXT,
            ad_sales REAL,
            impressions INTEGER,
            ad_spend REAL,
            clicks INTEGER,
            units_sold INTEGER,
            PRIMARY KEY (date, item_id)
        );
    `,
    'product_total_sales_metrics': `
        CREATE TABLE IF NOT EXISTS product_total_sales_metrics (
            date TEXT,
            item_id TEXT,
            total_sales REAL,
            total_units_ordered INTEGER,
            PRIMARY KEY (date, item_id)
        );
    `,
    'product_eligibility': `
        CREATE TABLE IF NOT EXISTS product_eligibility (
            eligibility_datetime_utc TEXT,
            item_id TEXT,
            eligibility BOOLEAN,
            message TEXT,
            PRIMARY KEY (eligibility_datetime_utc, item_id)
        );
    `
};

// Helper function to simulate typing effect
const typeText = (text, setter, delay = 20) => {
    let i = 0;
    setter('');
    const interval = setInterval(() => {
        if (i < text.length) {
            setter(prev => prev + text.charAt(i));
            i++;
        } else {
            clearInterval(interval);
        }
    }, delay);
};

export default function App() {
    const [apiKey, setApiKey] = useState('');
    const [db, setDb] = useState(null);
    const [productAdSalesCsv, setProductAdSalesCsv] = useState(null);
    const [productTotalSalesCsv, setProductTotalSalesCsv] = useState(null);
    const [productEligibilityCsv, setProductEligibilityCsv] = useState(null);
    const [question, setQuestion] = useState('');
    const [answer, setAnswer] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [dbStatus, setDbStatus] = useState('Initializing database...');
    const [error, setError] = useState('');
    const [isDatabaseReady, setIsDatabaseReady] = useState(false);
    const [chartData, setChartData] = useState(null);
    const [chartType, setChartType] = useState(null);
    const chartRef = useRef(null);
    const chartCanvasRef = useRef(null);

    // Initialize SQL.js database when component mounts
    useEffect(() => {
        const initDB = async () => {
            try {
                const SQL = await initSqlJs({
                    locateFile: file => `https://sql.js.org/dist/${file}`
                });
                const newDb = new SQL.Database();
                setDb(newDb);
                setDbStatus('Database initialized. Please upload CSV files.');
            } catch (err) {
                setError(`Failed to initialize database: ${err.message}`);
                setDbStatus('Database initialization failed.');
            }
        };
        initDB();
    }, []);

    // Cleanup database on unmount
    useEffect(() => {
        return () => {
            if (db) {
                db.close();
            }
        };
    }, [db]);

    // Render chart when chartData changes
    useEffect(() => {
        if (chartRef.current) {
            chartRef.current.destroy();
        }

        if (chartData && chartType && chartCanvasRef.current) {
            const ctx = chartCanvasRef.current.getContext('2d');
            chartRef.current = new Chart(ctx, {
                type: chartType,
                data: chartData,
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'top',
                        },
                        title: {
                            display: true,
                            text: chartData.datasets[0].label || 'Visualization'
                        }
                    }
                },
            });
        }
    }, [chartData, chartType]);

    const handleFileUpload = (event, setter) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                setter(e.target.result);
                setError('');
            };
            reader.onerror = () => {
                setError('Failed to read file.');
            };
            reader.readAsText(file);
        }
    };

    const loadDataIntoDB = async () => {
        if (!db) {
            setError('Database not initialized.');
            return;
        }
        if (!productAdSalesCsv || !productTotalSalesCsv || !productEligibilityCsv) {
            setError('Please upload all three CSV files.');
            return;
        }

        setIsLoading(true);
        setError('');
        setDbStatus('Loading data into database...');

        try {
            // Create tables based on the defined schemas
            for (const tableName in TABLE_SCHEMAS) {
                db.exec(TABLE_SCHEMAS[tableName]);
            }

            const parseAndInsert = (csvContent, tableName) => {
                return new Promise((resolve, reject) => {
                    Papa.parse(csvContent, {
                        header: true,
                        skipEmptyLines: true,
                        complete: (results) => {
                            if (results.errors.length) {
                                reject(new Error(`CSV parsing error for ${tableName}: ${results.errors[0].message}`));
                                return;
                            }
                            const data = results.data;
                            if (data.length === 0) {
                                console.warn(`No data found in ${tableName} CSV.`);
                                resolve();
                                return;
                            }

                            const columns = Object.keys(data[0]).map(col => `"${col}"`).join(', ');
                            const placeholders = Object.keys(data[0]).map(() => '?').join(', ');

                            db.exec("BEGIN TRANSACTION;");
                            let stmt = null;

                            try {
                                stmt = db.prepare(`INSERT INTO ${tableName} (${columns}) VALUES (${placeholders});`);
                                for (const row of data) {
                                    const values = Object.values(row).map(value => {
                                        if (typeof value === 'string') {
                                            if (value.toUpperCase() === 'TRUE') return 1;
                                            if (value.toUpperCase() === 'FALSE') return 0;
                                            if (value.trim() === '') return null;
                                        }
                                        if (value !== null && !isNaN(parseFloat(value)) && isFinite(value)) {
                                            return parseFloat(value);
                                        }
                                        return value;
                                    });
                                    stmt.run(values);
                                }
                                db.exec("COMMIT;");
                                stmt.free();
                                resolve();
                            } catch (insertErr) {
                                db.exec("ROLLBACK;");
                                if (stmt) stmt.free();
                                reject(new Error(`Error inserting data into ${tableName}: ${insertErr.message}`));
                            }
                        },
                        error: (err) => reject(err)
                    });
                });
            };

            await parseAndInsert(productAdSalesCsv, 'product_ad_sales_metrics');
            await parseAndInsert(productTotalSalesCsv, 'product_total_sales_metrics');
            await parseAndInsert(productEligibilityCsv, 'product_eligibility');

            setIsDatabaseReady(true);
            setDbStatus('All data loaded successfully!');
        } catch (err) {
            setError(`Error loading data: ${err.message}`);
            setDbStatus('Data loading failed.');
        } finally {
            setIsLoading(false);
        }
    };

    const askQuestion = async () => {
        if (!apiKey) {
            setError('Please enter your Gemini API Key.');
            return;
        }
        if (!db) {
            setError('Database not initialized.');
            return;
        }
        if (!isDatabaseReady) {
            setError('Please load the datasets into the database first.');
            return;
        }
        if (!question.trim()) {
            setError('Please enter a question.');
            return;
        }

        setIsLoading(true);
        setAnswer('');
        setError('');
        setChartData(null);
        setChartType(null);

        try {
            const schemaDefinition = Object.values(TABLE_SCHEMAS).join('\n');
            const sqlPrompt = `Given the following SQLite database schema:\n\n\`\`\`sql\n${schemaDefinition}\n\`\`\`\n\nConvert the following natural language question into a single SQL query. Only return the SQL query in a JSON object like {"sql_query": "YOUR_SQL_QUERY_HERE"}, nothing else. Do not include any explanations or extra text outside the JSON. If the question cannot be answered with the provided schema, return '{"sql_query": "N/A"}'.\n\nQuestion: ${question}`;

            const payloadSql = {
                contents: [{ role: "user", parts: [{ text: sqlPrompt }] }],
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: "OBJECT",
                        properties: {
                            "sql_query": { "type": "STRING" }
                        },
                        "propertyOrdering": ["sql_query"]
                    }
                }
            };

            const apiUrlSql = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
            const responseSql = await fetch(apiUrlSql, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payloadSql)
            });

            const resultSql = await responseSql.json();
            let sqlQuery = '';
            if (resultSql.candidates && resultSql.candidates.length > 0 &&
                resultSql.candidates[0].content && resultSql.candidates[0].content.parts &&
                resultSql.candidates[0].content.parts.length > 0) {
                const jsonText = resultSql.candidates[0].content.parts[0].text;
                try {
                    const parsedJson = JSON.parse(jsonText);
                    sqlQuery = parsedJson.sql_query;
                } catch (parseError) {
                    setError(`AI returned invalid JSON for SQL: ${jsonText}. Error: ${parseError.message}`);
                    setIsLoading(false);
                    return;
                }
            } else {
                setError('Failed to get SQL query from AI. Please try again.');
                setIsLoading(false);
                return;
            }

            if (sqlQuery.toUpperCase().includes('N/A')) {
                typeText("I'm sorry, I cannot answer that question with the available data.", setAnswer);
                setIsLoading(false);
                return;
            }

            let queryResults = [];
            let columns = [];
            try {
                const res = db.exec(sqlQuery);
                if (res.length > 0) {
                    columns = res[0].columns;
                    queryResults = res[0].values.map(row => {
                        const obj = {};
                        columns.forEach((col, i) => {
                            obj[col] = row[i];
                        });
                        return obj;
                    });
                } else {
                    typeText("The query executed successfully but returned no results.", setAnswer);
                    setIsLoading(false);
                    return;
                }
            } catch (sqlError) {
                setError(`SQL execution error: ${sqlError.message}. Generated SQL: ${sqlQuery}`);
                setIsLoading(false);
                return;
            }

            const resultPrompt = `Given the following data from a database query:\n\n\`\`\`json\n${JSON.stringify(queryResults, null, 2)}\n\`\`\`\n\nAnd the original question was: "${question}"\n\nProvide a concise, human-readable answer. Also, if a visualization is appropriate for this data, suggest the 'chart_type' (e.g., 'bar', 'line', 'pie', 'doughnut') and 'labels' (the column name for the x-axis or categories, e.g., 'item_id' or 'date') and 'values' (the column name for the y-axis or data, e.g., 'total_sales') from the provided data. If no visualization is suitable, set 'chart_type' to null. Ensure 'labels' and 'values' are valid column names from the provided JSON data.\n\nReturn the response in JSON format: \`\`\`json\n{\n  "answer": "...",\n  "visualization": {\n    "chart_type": "...",\n    "labels": "...",\n    "values": "..."\n  }\n}\n\`\`\``;

            const payloadResult = {
                contents: [{ role: "user", parts: [{ text: resultPrompt }] }],
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: "OBJECT",
                        properties: {
                            "answer": { "type": "STRING" },
                            "visualization": {
                                "type": "OBJECT",
                                "properties": {
                                    "chart_type": { "type": "STRING", "nullable": true },
                                    "labels": { "type": "STRING", "nullable": true },
                                    "values": { "type": "STRING", "nullable": true }
                                }
                            }
                        },
                        "propertyOrdering": ["answer", "visualization"]
                    }
                }
            };

            const apiUrlResult = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
            const responseResult = await fetch(apiUrlResult, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payloadResult)
            });

            const resultFinal = await responseResult.json();
            if (resultFinal.candidates && resultFinal.candidates.length > 0 &&
                resultFinal.candidates[0].content && resultFinal.candidates[0].content.parts &&
                resultFinal.candidates[0].content.parts.length > 0) {
                const jsonText = resultFinal.candidates[0].content.parts[0].text;
                try {
                    const parsedFinal = JSON.parse(jsonText);
                    typeText(parsedFinal.answer, setAnswer);
                    if (parsedFinal.visualization && parsedFinal.visualization.chart_type &&
                        parsedFinal.visualization.labels && parsedFinal.visualization.values) {
                        const chartLabelsCol = parsedFinal.visualization.labels;
                        const chartValuesCol = parsedFinal.visualization.values;
                        const labels = queryResults.map(row => row[chartLabelsCol]);
                        const values = queryResults.map(row => row[chartValuesCol]);
                        if (labels.every(l => l !== undefined && l !== null) && values.every(v => v !== undefined && v !== null)) {
                            setChartType(parsedFinal.visualization.chart_type);
                            setChartData({
                                labels: labels,
                                datasets: [{
                                    label: `${chartValuesCol} by ${chartLabelsCol}`,
                                    data: values,
                                    backgroundColor: [
                                        'rgba(255, 99, 132, 0.6)', 'rgba(54, 162, 235, 0.6)', 'rgba(255, 206, 86, 0.6)',
                                        'rgba(75, 192, 192, 0.6)', 'rgba(153, 102, 255, 0.6)', 'rgba(255, 159, 64, 0.6)',
                                        'rgba(199, 199, 199, 0.6)', 'rgba(83, 102, 102, 0.6)', 'rgba(102, 204, 153, 0.6)'
                                    ],
                                    borderColor: [
                                        'rgba(255, 99, 132, 1)', 'rgba(54, 162, 235, 1)', 'rgba(255, 206, 86, 1)',
                                        'rgba(75, 192, 192, 1)', 'rgba(153, 102, 255, 1)', 'rgba(255, 159, 64, 1)',
                                        'rgba(199, 199, 199, 1)', 'rgba(83, 102, 102, 1)', 'rgba(102, 204, 153, 1)'
                                    ],
                                    borderWidth: 1,
                                }],
                            });
                        } else {
                            console.warn("AI suggested visualization with invalid or missing columns after query. Chart not rendered.");
                            setError("AI suggested a visualization, but the data columns for it were not found. Try a different question or examine your data.");
                            setChartData(null);
                        }
                    }
                } catch (parseError) {
                    setError(`AI returned an unreadable response. Error: ${parseError.message}`);
                }
            } else {
                setError('Failed to get a response from AI. Please try again.');
            }
        } catch (err) {
            setError(`An unexpected error occurred: ${err.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="main-container">
            <div className="card">
                <h1 className="main-title">E-commerce Data AI Agent</h1>

                {/* API Key Input */}
                <div className="section api-key-section">
                    <label htmlFor="api-key" className="label">
                        Gemini LLM API Key:
                    </label>
                    <input
                        type="password"
                        id="api-key"
                        className="input-field"
                        placeholder="Enter your Gemini API Key"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                    />
                    <p className="hint">
                        Your API key is used to connect to the Gemini LLM. It is processed client-side.
                    </p>
                </div>

                {/* CSV Upload Section */}
                <div className="section upload-section">
                    <h2 className="section-title">Upload Datasets (.csv)</h2>
                    <div className="grid">
                        <div>
                            <label className="label">Product Ad Sales:</label>
                            <input
                                type="file"
                                accept=".csv"
                                onChange={(e) => handleFileUpload(e, setProductAdSalesCsv)}
                                className="file-input"
                            />
                            {productAdSalesCsv && <p className="success-message">Loaded!</p>}
                        </div>
                        <div>
                            <label className="label">Product Total Sales:</label>
                            <input
                                type="file"
                                accept=".csv"
                                onChange={(e) => handleFileUpload(e, setProductTotalSalesCsv)}
                                className="file-input"
                            />
                            {productTotalSalesCsv && <p className="success-message">Loaded!</p>}
                        </div>
                        <div>
                            <label className="label">Product Eligibility:</label>
                            <input
                                type="file"
                                accept=".csv"
                                onChange={(e) => handleFileUpload(e, setProductEligibilityCsv)}
                                className="file-input"
                            />
                            {productEligibilityCsv && <p className="success-message">Loaded!</p>}
                        </div>
                    </div>
                    <button
                        onClick={loadDataIntoDB}
                        disabled={isLoading || !db || !productAdSalesCsv || !productTotalSalesCsv || !productEligibilityCsv}
                        className="button-primary"
                    >
                        {isLoading ? 'Loading Data...' : 'Load Data into Database'}
                    </button>
                    <p className="status-message">{dbStatus}</p>
                </div>

                {/* Question Input */}
                <div className="section question-section">
                    <label htmlFor="question" className="label">
                        Ask a question about your data:
                    </label>
                    <textarea
                        id="question"
                        rows="3"
                        className="textarea-field"
                        placeholder="e.g., What is my total sales? Calculate the RoAS. Which product had the highest CPC?"
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        disabled={isLoading || !isDatabaseReady}
                    ></textarea>
                    <button
                        onClick={askQuestion}
                        disabled={isLoading || !isDatabaseReady || !apiKey || !question.trim()}
                        className="button-secondary"
                    >
                        {isLoading ? 'Thinking...' : 'Ask AI Agent'}
                    </button>
                </div>

                {/* Response Area */}
                <div className="section response-section">
                    <h2 className="section-title">AI Agent Response:</h2>
                    {error && (
                        <div className="error-alert" role="alert">
                            <strong className="bold-text">Error!</strong>
                            <span className="error-message">{error}</span>
                        </div>
                    )}
                    <div className="response-box">
                        {answer || (isLoading ? "..." : "Your answer will appear here.")}
                    </div>

                    {/* Chart Display */}
                    {chartData && chartType && (
                        <div className="chart-container">
                            <h3 className="chart-title">Data Visualization:</h3>
                            <div className="chart-canvas-wrapper">
                                <canvas ref={chartCanvasRef}></canvas>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
