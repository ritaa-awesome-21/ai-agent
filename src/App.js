import React, { useState, useEffect, useRef } from 'react';
import initSqlJs from 'sql.js';
import Papa from 'papaparse';
import Chart from 'chart.js/auto';

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
            eligibility BOOLEAN, -- Will be stored as 0 or 1 in SQLite
            message TEXT,
            PRIMARY KEY (eligibility_datetime_utc, item_id)
        );
    `
};

// Helper function to simulate typing effect
const typeText = (text, setter, delay = 20) => {
    let i = 0;
    setter(''); // Clear previous text
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
    const chartRef = useRef(null); // Ref for the Chart.js instance
    const chartCanvasRef = useRef(null); // Ref for the canvas element

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
    }, []); // Empty dependency array means this runs once on mount

    // Cleanup database on unmount
    useEffect(() => {
        return () => {
            if (db) {
                db.close();
            }
        };
    }, [db]); // Runs when 'db' changes (e.g., on unmount or re-initialization)

    // Render chart when chartData changes
    useEffect(() => {
        if (chartRef.current) {
            chartRef.current.destroy(); // Destroy existing chart instance to prevent duplicates
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
    }, [chartData, chartType]); // Reruns when chart data or type changes

    const handleFileUpload = (event, setter) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                setter(e.target.result);
                setError(''); // Clear any previous errors on new file upload
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
        setError(''); // Clear previous errors
        setDbStatus('Loading data into database...');

        try {
            // Create tables based on the defined schemas
            for (const tableName in TABLE_SCHEMAS) {
                db.exec(TABLE_SCHEMAS[tableName]);
            }

            // Parse and insert data function
            const parseAndInsert = (csvContent, tableName) => {
                return new Promise((resolve, reject) => {
                    Papa.parse(csvContent, {
                        header: true, // Treat the first row as column headers
                        skipEmptyLines: true, // Ignore any blank rows in the CSV
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

                            // Dynamically get columns from the parsed data to form SQL INSERT
                            const columns = Object.keys(data[0]).map(col => `"${col}"`).join(', ');
                            const placeholders = Object.keys(data[0]).map(() => '?').join(', ');

                            // Begin a SQL transaction for faster and more reliable insertions
                            db.exec("BEGIN TRANSACTION;");
                            let stmt = null; // Declare statement variable outside try-catch for wider scope

                            try {
                                // Prepare the insert statement once for efficiency
                                stmt = db.prepare(`INSERT INTO ${tableName} (${columns}) VALUES (${placeholders});`);

                                for (const row of data) {
                                    // Map values for the prepared statement, handling type conversions
                                    const values = Object.values(row).map(value => {
                                        // Convert 'TRUE'/'FALSE' strings to 1/0 for BOOLEAN
                                        if (typeof value === 'string') {
                                            if (value.toUpperCase() === 'TRUE') return 1;
                                            if (value.toUpperCase() === 'FALSE') return 0;
                                            if (value.trim() === '') return null; // Convert empty strings to NULL
                                        }
                                        // Convert to float if it's a valid number and not an empty string
                                        if (value !== null && !isNaN(parseFloat(value)) && isFinite(value)) {
                                            return parseFloat(value);
                                        }
                                        return value; // Return as is for other types or nulls
                                    });
                                    stmt.run(values); // Execute the prepared statement with current row's values
                                }
                                db.exec("COMMIT;"); // Commit the transaction if all insertions are successful
                                stmt.free(); // Free the prepared statement resources
                                resolve(); // Resolve the promise indicating success
                            } catch (insertErr) {
                                db.exec("ROLLBACK;"); // Rollback the transaction on any error
                                if (stmt) stmt.free(); // Ensure statement is freed even on error
                                reject(new Error(`Error inserting data into ${tableName}: ${insertErr.message}`));
                            }
                        },
                        error: (err) => reject(err) // Handle PapaParse errors
                    });
                });
            };

            // Await parsing and insertion for each CSV file
            await parseAndInsert(productAdSalesCsv, 'product_ad_sales_metrics');
            await parseAndInsert(productTotalSalesCsv, 'product_total_sales_metrics');
            await parseAndInsert(productEligibilityCsv, 'product_eligibility');

            setIsDatabaseReady(true); // Set flag that database is ready for queries
            setDbStatus('All data loaded successfully!');
        } catch (err) {
            setError(`Error loading data: ${err.message}`);
            setDbStatus('Data loading failed.');
        } finally {
            setIsLoading(false); // End loading state regardless of success or failure
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
        setAnswer(''); // Clear previous answer
        setError(''); // Clear previous error
        setChartData(null); // Clear previous chart
        setChartType(null); // Clear previous chart type

        try {
            // Step 1: Get SQL query from LLM
            const schemaDefinition = Object.values(TABLE_SCHEMAS).join('\n');
            const derivedMetricsContext = `
            -- Key Derived Metrics & Calculations (from product_ad_sales_metrics):
            --   Cost Per Click (CPC) = ad_spend / clicks (ensure clicks > 0 to avoid division by zero)
            --   Return on Ad Spend (RoAS) = ad_sales / ad_spend (ensure ad_spend > 0 to avoid division by zero)

            -- IMPORTANT: When asked for CPC or RoAS, calculate it directly in the SQL query.
            -- Example for CPC: SELECT item_id, (ad_spend * 1.0 / clicks) AS cpc FROM product_ad_sales_metrics WHERE clicks > 0 ORDER BY cpc DESC LIMIT 1;
            -- Example for RoAS: SELECT item_id, (ad_sales * 1.0 / ad_spend) AS roas FROM product_ad_sales_metrics WHERE ad_spend > 0 ORDER BY roas DESC LIMIT 1;
            -- Use * 1.0 for division to ensure float results in SQLite.
            `;

            // The prompt now requests SQL within a code block, removing strict JSON output
            const sqlPrompt = `Given the following SQLite database schema:\n\n\`\`\`sql\n${schemaDefinition}\n\`\`\`\n\n${derivedMetricsContext}\n\nConvert the following natural language question into a single SQL query. The SQL query should be provided within a markdown SQL code block (e.g., \`\`\`sql\nSELECT ...\n\`\`\`). Do NOT include any other text or explanations outside the SQL code block. If the question cannot be answered with the provided schema and derived metrics, provide \`\`\`sql\n-- N/A\n\`\`\`.\n\nQuestion: ${question}`;

            const payloadSql = {
                contents: [{ role: "user", parts: [{ text: sqlPrompt }] }],
                // Removed responseMimeType and responseSchema to allow plain text output from LLM for SQL
            };

            const apiUrlSql = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
            const responseSql = await fetch(apiUrlSql, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payloadSql)
            });

            const resultSql = await responseSql.json();
            console.log("LLM SQL Raw Response:", resultSql); // For debugging

            let sqlQuery = '';
            if (resultSql.candidates && resultSql.candidates.length > 0 &&
                resultSql.candidates[0].content && resultSql.candidates[0].content.parts &&
                resultSql.candidates[0].content.parts.length > 0) {
                const rawText = resultSql.candidates[0].content.parts[0].text;
                // Extract SQL from markdown code block using regex
                const sqlMatch = rawText.match(/```sql\n([\s\S]*?)\n```/);
                if (sqlMatch && sqlMatch[1]) {
                    sqlQuery = sqlMatch[1].trim();
                } else {
                    // If no SQL block, or empty, consider it unanswerable or an error
                    setError('AI did not return a valid SQL code block. Raw response: ' + rawText.substring(0, 200) + '...');
                    setIsLoading(false);
                    return;
                }
            } else {
                setError('Failed to get SQL query from AI. Please try again.');
                setIsLoading(false);
                return;
            }

            if (sqlQuery.toUpperCase().includes('-- N/A') || sqlQuery.toUpperCase().includes('N/A')) { // Check for N/A from AI
                typeText("I'm sorry, I cannot answer that question with the available data or derived metrics.", setAnswer);
                setIsLoading(false);
                return;
            }

            // Step 2: Execute SQL query on the in-browser database
            let queryResults = [];
            let columns = [];
            try {
                const res = db.exec(sqlQuery);
                if (res.length > 0) {
                    columns = res[0].columns;
                    // Convert results to an array of objects for easier processing
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

            // Step 3: Get human-readable answer and visualization suggestion from LLM
            const resultPrompt = `Given the following data from a database query:\n\n\`\`\`json\n${JSON.stringify(queryResults, null, 2)}\n\`\`\`\n\nAnd the original question was: "${question}"\n\nProvide a detailed and analytical answer. Explain the key findings, potential implications, and any relevant trends or comparisons you can infer from the data. Present the information clearly and comprehensively. For any numerical result, state the unit if applicable (e.g., dollars, units, percentage). Also, if a visualization is appropriate for this data, suggest the 'chart_type' (e.g., 'bar', 'line', 'pie', 'doughnut') and 'labels' (the column name for the x-axis or categories, e.g., 'item_id' or 'date') and 'values' (the column name for the y-axis or data, e.g., 'total_sales' or 'cpc_calculated') from the provided data. Prioritize charts for comparative or trend-based answers. If no visualization is suitable, set 'chart_type' to null. Ensure 'labels' and 'values' are valid column names from the provided JSON data.\n\nReturn the response in JSON format: \`\`\`json\n{\n  "answer": "...",\n  "visualization": {\n    "chart_type": "...",\n    "labels": "...",\n    "values": "..."\n  }\n}\n\`\`\``;

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
            console.log("LLM Final Response:", resultFinal); // For debugging

            if (resultFinal.candidates && resultFinal.candidates.length > 0 &&
                resultFinal.candidates[0].content && resultFinal.candidates[0].content.parts &&
                resultFinal.candidates[0].content.parts.length > 0) {
                const jsonText = resultFinal.candidates[0].content.parts[0].text;
                try {
                    const parsedFinal = JSON.parse(jsonText);
                    typeText(parsedFinal.answer, setAnswer); // Display answer with typing effect

                    if (parsedFinal.visualization && parsedFinal.visualization.chart_type &&
                        parsedFinal.visualization.labels && parsedFinal.visualization.values) {
                        const chartLabelsCol = parsedFinal.visualization.labels;
                        const chartValuesCol = parsedFinal.visualization.values;

                        const labels = queryResults.map(row => row[chartLabelsCol]);
                        const values = queryResults.map(row => row[chartValuesCol]);

                        // Ensure labels and values are valid and extracted correctly
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
                                        'rgba(199, 199, 199, 0.6)', 'rgba(83, 102, 102, 0.6)', 'rgba(102, 204, 153, 0.6)' // More colors for charts
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
                            // Only set error if visualization was suggested but data is bad
                            console.warn("LLM suggested visualization with invalid or missing columns after query. Chart not rendered.", { chartLabelsCol, chartValuesCol, queryResults });
                            setError("AI suggested a visualization, but the data columns for it were not found. Try a different question or examine your data.");
                            setChartData(null); // Ensure no incomplete chart is rendered
                        }
                    }
                } catch (parseError) {
                    setError(`AI returned an unreadable response. It might be generating too much text. Error: ${parseError.message}`);
                }
            } else {
                setError('Failed to get a response from AI. Please try again.');
            }

        } catch (err) {
            setError(`An unexpected error occurred during AI processing: ${err.message}`);
            console.error(err); // Log full error for debugging
        } finally {
            setIsLoading(false); // End loading state
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-200 p-4 sm:p-8 font-inter text-gray-800 flex items-center justify-center">
            <div className="bg-white rounded-xl shadow-2xl p-6 sm:p-10 w-full max-w-4xl border border-gray-200">
                <h1 className="text-3xl sm:text-4xl font-extrabold text-center text-purple-800 mb-8">
                    E-commerce Data AI Agent
                </h1>

                {/* API Key Input */}
                <div className="mb-6 p-4 bg-purple-50 rounded-lg border border-purple-200">
                    <label htmlFor="api-key" className="block text-lg font-medium text-purple-700 mb-2">
                        Gemini LLM API Key:
                    </label>
                    <input
                        type="password"
                        id="api-key"
                        className="w-full p-3 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent transition duration-200"
                        placeholder="Enter your Gemini API Key"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                    />
                    <p className="text-sm text-gray-500 mt-2">
                        Your API key is used to connect to the Gemini LLM. It is processed client-side.
                    </p>
                </div>

                {/* CSV Upload Section */}
                <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <h2 className="text-xl font-semibold text-blue-700 mb-4">Upload Datasets (.csv)</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Product Ad Sales:</label>
                            <input
                                type="file"
                                accept=".csv"
                                onChange={(e) => handleFileUpload(e, setProductAdSalesCsv)}
                                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-100 file:text-blue-700 hover:file:bg-blue-200 transition duration-200"
                            />
                            {productAdSalesCsv && <p className="text-xs text-green-600 mt-1">Loaded!</p>}
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Product Total Sales:</label>
                            <input
                                type="file"
                                accept=".csv"
                                onChange={(e) => handleFileUpload(e, setProductTotalSalesCsv)}
                                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-100 file:text-blue-700 hover:file:bg-blue-200 transition duration-200"
                            />
                            {productTotalSalesCsv && <p className="text-xs text-green-600 mt-1">Loaded!</p>}
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Product Eligibility:</label>
                            <input
                                type="file"
                                accept=".csv"
                                onChange={(e) => handleFileUpload(e, setProductEligibilityCsv)}
                                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-100 file:text-blue-700 hover:file:bg-blue-200 transition duration-200"
                            />
                            {productEligibilityCsv && <p className="text-xs text-green-600 mt-1">Loaded!</p>}
                        </div>
                    </div>
                    <button
                        onClick={loadDataIntoDB}
                        disabled={isLoading || !db || !productAdSalesCsv || !productTotalSalesCsv || !productEligibilityCsv}
                        className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg shadow-md hover:bg-blue-700 transition duration-300 ease-in-out font-semibold text-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isLoading ? 'Loading Data...' : 'Load Data into Database'}
                    </button>
                    <p className="text-sm text-gray-600 mt-2 text-center">{dbStatus}</p>
                </div>

                {/* Question Input */}
                <div className="mb-6 p-4 bg-green-50 rounded-lg border border-green-200">
                    <label htmlFor="question" className="block text-lg font-medium text-green-700 mb-2">
                        Ask a question about your data:
                    </label>
                    <textarea
                        id="question"
                        rows="3"
                        className="w-full p-3 border border-green-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent transition duration-200 resize-y"
                        placeholder="e.g., What is my total sales? Calculate the RoAS. Which product had the highest CPC?"
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        disabled={isLoading || !isDatabaseReady}
                    ></textarea>
                    <button
                        onClick={askQuestion}
                        disabled={isLoading || !isDatabaseReady || !apiKey || !question.trim()}
                        className="w-full mt-4 bg-green-600 text-white py-3 px-6 rounded-lg shadow-md hover:bg-green-700 transition duration-300 ease-in-out font-semibold text-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isLoading ? 'Thinking...' : 'Ask AI Agent'}
                    </button>
                </div>

                {/* Response Area */}
                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <h2 className="text-xl font-semibold text-gray-700 mb-4">AI Agent Response:</h2>
                    {error && (
                        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
                            <strong className="font-bold">Error!</strong>
                            <span className="block sm:inline ml-2">{error}</span>
                        </div>
                    )}
                    <div className="min-h-[100px] bg-white p-4 rounded-lg border border-gray-300 text-gray-800 whitespace-pre-wrap">
                        {answer || (isLoading ? "..." : "Your answer will appear here.")}
                    </div>

                    {/* Chart Display */}
                    {chartData && chartType && (
                        <div className="mt-6 p-4 bg-white rounded-lg shadow-inner border border-gray-300">
                            <h3 className="text-lg font-semibold text-gray-700 mb-3">Data Visualization:</h3>
                            <div className="relative h-64 w-full"> {/* Fixed height for chart */}
                                <canvas ref={chartCanvasRef}></canvas>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}