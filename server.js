const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const ExcelJS = require('exceljs');
const session = require('express-session');
const app = express();

app.use(express.json());
// Cấu hình session
app.use(session({
  secret: 'your-secret-key', // Thay bằng chuỗi bí mật ngẫu nhiên
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 60 * 1000 } // 30 phút (tính bằng mili giây)
}));
// Middleware HTTP Basic Authentication
const auth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    res.set('WWW-Authenticate', 'Basic realm="Secure Area"');
    return res.status(401).send('Authentication required');
  }

  const [username, password] = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
  if (username === 'admin' && password === 'password123') {
    // Đánh dấu session là đã xác thực
    req.session.isAuthenticated = true;
    req.session.lastActivity = Date.now();
    next();
  } else {
    res.set('WWW-Authenticate', 'Basic realm="Secure Area"');
    return res.status(401).send('Invalid credentials');
  }
};
// Middleware kiểm tra session (bảo vệ các route)
const checkSession = (req, res, next) => {
  if (!req.session.isAuthenticated || Date.now() - req.session.lastActivity > 30 * 60 * 1000) {
    req.session.destroy(() => {
      res.set('WWW-Authenticate', 'Basic realm="Secure Area"');
      return res.status(401).send('Session expired. Please log in again.');
    });
  } else {
    req.session.lastActivity = Date.now(); // Cập nhật thời gian hoạt động
    next();
  }
};

// Serve trang index.html không cần bảo mật
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.get('/index.html', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Serve các trang HTML bảo mật
app.get('/Location.html', auth, checkSession, (req, res) => {
    res.sendFile(__dirname + '/Location.html');
});

app.get('/scrap_material.html', auth, checkSession, (req, res) => {
    res.sendFile(__dirname + '/scrap_material.html');
});

app.get('/weight_type.html', auth, checkSession, (req, res) => {
    res.sendFile(__dirname + '/weight_type.html');
});
// Thêm endpoint mới cho /weight_data_{date}.json
app.post('/weight_data_:date.json', async (req, res) => {
    const date = req.params.date; // Lấy date từ URL (ví dụ: 20250624)
    const filename = `weight_data_${date}.json`;
    try {
        let existingData = [];
        try {
            const data = await fs.readFile(filename, 'utf8');
            existingData = JSON.parse(data);
        } catch (e) {
            // Nếu file không tồn tại, tạo mảng rỗng
        }

        const newData = req.body;
        // Kiểm tra trùng lặp dựa trên BatchID và Time (giả sử là cột duy nhất)
        const uniqueNewData = newData.filter(newItem =>
            !existingData.some(existingItem =>
                existingItem.BatchID === newItem.BatchID && existingItem.Time === newItem.Time
            )
        );
        existingData = [...existingData, ...uniqueNewData];
        const jsonData = JSON.stringify(existingData, null, 2);
        await fs.writeFile(filename, jsonData, 'utf8');
        res.status(200).send(`Saved ${filename} successfully with ${existingData.length} records`);        
    } catch (error) {
        res.status(500).send(`Error saving ${filename}: ${error.message}`);
    }
});
// Endpoint để kiểm tra kích thước file JSON
app.get('/check-file-size/:filename', async (req, res) => {
    const filename = req.params.filename;
    try {
        const stats = await fs.stat(filename);
        res.send(`File ${filename} size: ${stats.size} bytes`);
    } catch (error) {
        res.status(500).send(`Error checking size of ${filename}: ${error.message}`);
    }
});

// Endpoint cho weight_data.json theo ngày (tích lũy dữ liệu)
app.get('/weight_data/:date.json', async (req, res) => {
    const date = req.params.date; // Ví dụ: 20250623
    const filename = `weight_data_${date}.json`;
    try {
        const data = await fs.readFile(filename, 'utf8');
        res.json(JSON.parse(data));
    } catch (error) {
        res.status(404).send(`File ${filename} not found`);
    }
});

app.post('/weight_data/:date.json', async (req, res) => {
    const date = req.params.date; // Ví dụ: 20250623
    const filename = `weight_data_${date}.json`;
    try {
        let existingData = [];
        try {
            const data = await fs.readFile(filename, 'utf8');
            existingData = JSON.parse(data);
        } catch (e) {
            // Nếu file không tồn tại, tạo mảng rỗng
        }

        const newData = req.body; // Dữ liệu mới từ VB.NET
        existingData = [...existingData, ...newData]; // Ghép dữ liệu cũ và mới
        const jsonData = JSON.stringify(existingData, null, 2);
        await fs.writeFile(filename, jsonData, 'utf8');
        res.status(200).send(`Saved ${filename} successfully with ${existingData.length} records`);
    } catch (error) {
        res.status(500).send(`Error saving ${filename}: ${error.message}`);
    }
});

// Endpoint để xuất Excel
app.get('/export-weight-data', async (req, res) => {
    const batchId = req.query.batchid || '';
    try {
        const files = (await fs.readdir(__dirname)).filter(file => file.startsWith('weight_data_') && file.endsWith('.json'));
        let allData = [];
        for (const file of files) {
            try {
                const data = await fs.readFile(file, 'utf8');
                allData = allData.concat(JSON.parse(data));
            } catch (e) {
                console.error(`Error reading ${file}: ${e.message}`);
                continue;
            }
        }

        const filteredData = batchId ? allData.filter(item => item.BatchID && item.BatchID.toString() === batchId) : allData;
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('WeightData');

        worksheet.columns = [
            { header: 'Số thứ tự', key: 'Seq', width: 10 },
            { header: 'Lần cân', key: 'Weighing', width: 10 },
            { header: 'Loại phế liệu', key: 'Scrap_categories', width: 20 },
            { header: 'Loại cân', key: 'WeightType', width: 15 },
            { header: 'Số cân (kg)', key: 'Weight', width: 15 },
            { header: 'Thời gian cân', key: 'Time', width: 20 },
            { header: 'Trạng thái', key: 'Status', width: 15 },
            { header: 'Ghi chú', key: 'Remark', width: 20 },
            { header: 'Mã máy cân', key: 'MachineCode', width: 15 },
            { header: 'Vị trí cân', key: 'Location', width: 15 },
            { header: 'BatchID', key: 'BatchID', width: 15 }
        ];

        filteredData.forEach(item => {
            worksheet.addRow({
                Seq: item.Seq || 'N/A',
                Weighing: item.Weighing || 'N/A',
                Scrap_categories: item.Scrap_categories || 'N/A',
                WeightType: item.WeightType || 'N/A',
                Weight: item.Weight || 'N/A',
                Time: item.Time ? new Date(item.Time).toLocaleString('vi-VN') : 'N/A',
                Status: item.Status || 'N/A',
                Remark: item.Remark || '',
                MachineCode: item.MachineCode || 'N/A',
                Location: item.Location || 'N/A',
                BatchID: item.BatchID || 'N/A'
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=weight_data_${batchId || 'all'}_${Date.now()}.xlsx`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('Error exporting to Excel:', error);
        res.status(500).send('Error exporting data to Excel');
    }
});

// Endpoint cho weight_data.html với lọc theo BatchID và server-side rendering
app.get('/weight_data.html', async (req, res) => {
    const batchId = req.query.batchid || ''; // Lấy tham số BatchID (ví dụ: 2025-06-23-01)
    let htmlContent = `
        <!DOCTYPE html>
        <html lang="vi">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Quản lý dữ liệu cân</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    max-width: 1000px;
                    margin: 0 auto;
                    padding: 20px;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 20px;
                }
                th, td {
                    border: 1px solid #ddd;
                    padding: 8px;
                    text-align: left;
                }
                th {
                    background-color: #f2f2f2;
                }
                .filter-container {
                    margin-bottom: 20px;
                }
                input, button {
                    margin: 5px;
                    padding: 5px;
                }
                input {
                    width: 200px;
                }
                button {
                    background-color: #f2f2f2;
                    border: 1px solid #ddd;
                    border-radius: 5px;
                    cursor: pointer;
                }
                button:hover {
                    background-color: #ddd;
                }
                .nav-container {
                    margin-bottom: 20px;
                }
                .nav-container a {
                    display: inline-block;
                    padding: 10px;
                    background-color: #f2f2f2;
                    color: #333;
                    text-decoration: none;
                    border-radius: 5px;
                    font-size: 1.1em;
                }
                .nav-container a:hover {
                    background-color: #ddd;
                }
            </style>
        </head>
        <body>
            <h2>Quản lý dữ liệu cân</h2>
            <div class="nav-container">
                <a href="/index.html">Về trang chủ</a>
            </div>
            <div class="filter-container">
                <form action="/weight_data.html" method="get">
                    <label>Lọc theo BatchID: <input type="text" name="batchid" value="${batchId}" placeholder="e.g., 2025-06-23-01"></label>
                    <button type="submit">Lọc</button>
                    <button type="submit" formaction="/export-weight-data?batchid=${batchId}" formmethod="get">Xuất Excel</button>
                </form>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Số thứ tự</th>
                        <th>Lần cân</th>
                        <th>Loại phế liệu</th>
                        <th>Loại cân</th>
                        <th>Số cân (kg)</th>
                        <th>Thời gian cân</th>
                        <th>Trạng thái</th>
                        <th>Ghi chú</th>
                        <th>Mã máy cân</th>
                        <th>Vị trí cân</th>
                        <th>BatchID</th>
                    </tr>
                </thead>
                <tbody>
    `;

    // Chỉ xử lý dữ liệu khi có batchId
    if (batchId) {
        try {
            const files = (await fs.readdir(__dirname)).filter(file => file.startsWith('weight_data_') && file.endsWith('.json'));
            if (files.length === 0) {
                htmlContent += '<tr><td colspan="11">Không tìm thấy file dữ liệu cân.</td></tr>';
            } else {
                let allData = [];
                for (const file of files) {
                    try {
                        const data = await fs.readFile(file, 'utf8');
                        const jsonData = JSON.parse(data);
                        allData = allData.concat(jsonData);
                    } catch (e) {
                        console.error(`Error reading ${file}: ${e.message}`);
                        continue; // Bỏ qua file lỗi
                    }
                }

                const filteredData = allData.filter(item => item.BatchID && item.BatchID.toString() === batchId);
                if (filteredData.length > 0) {
                    filteredData.forEach(item => {
                        htmlContent += `
                            <tr>
                                <td>${item.Seq || 'N/A'}</td>
                                <td>${item.Weighing || 'N/A'}</td>
                                <td>${item.Scrap_categories || 'N/A'}</td>
                                <td>${item.WeightType || 'N/A'}</td>
                                <td>${item.Weight || 'N/A'}</td>
                                <td>${item.Time ? new Date(item.Time).toLocaleString('vi-VN') : 'N/A'}</td>
                                <td>${item.Status || 'N/A'}</td>
                                <td>${item.Remark || ''}</td>
                                <td>${item.MachineCode || 'N/A'}</td>
                                <td>${item.Location || 'N/A'}</td>
                                <td>${item.BatchID || 'N/A'}</td>
                            </tr>
                        `;
                    });
                } else {
                    htmlContent += `<tr><td colspan="11">Không tìm thấy dữ liệu cho BatchID: ${batchId}</td></tr>`;
                }
            }
        } catch (error) {
            console.error('Error in weight_data.html endpoint:', error);
            htmlContent += `<tr><td colspan="11">Lỗi tải dữ liệu: ${error.message}</td></tr>`;
        }
    } else {
        htmlContent += '<tr><td colspan="11">Vui lòng nhập BatchID và nhấn Lọc để xem dữ liệu.</td></tr>';
    }

    htmlContent += '</tbody></table></body></html>';
    res.send(htmlContent);
});

// Endpoint cho các file JSON khác (bảo mật)
app.get('/location.json', async (req, res) => {
    try {
        const data = await fs.readFile('location.json', 'utf8');
        res.json(JSON.parse(data));
    } catch (error) {
        res.status(500).send('Error reading locations');
    }
});

app.post('/location.json', async (req, res) => {
    try {
        await fs.writeFile('location.json', JSON.stringify(req.body, null, 2));
        res.send('Saved locations successfully');
    } catch (error) {
        res.status(500).send('Error saving locations');
    }
});

app.get('/scrap_material.json', async (req, res) => {
    try {
        const data = await fs.readFile('scrap_material.json', 'utf8');
        res.json(JSON.parse(data));
    } catch (error) {
        res.status(500).send('Error reading materials');
    }
});

app.post('/scrap_material.json', async (req, res) => {
    try {
        await fs.writeFile('scrap_material.json', JSON.stringify(req.body, null, 2));
        res.send('Saved materials successfully');
    } catch (error) {
        res.status(500).send('Error saving materials');
    }
});

app.get('/weight_type.json', async (req, res) => {
    try {
        const data = await fs.readFile('weight_type.json', 'utf8');
        res.json(JSON.parse(data));
    } catch (error) {
        res.status(500).send('Error reading weight types');
    }
});

app.post('/weight_type.json', async (req, res) => {
    try {
        await fs.writeFile('weight_type.json', JSON.stringify(req.body, null, 2));
        res.send('Saved weight types successfully');
    } catch (error) {
        res.status(500).send('Error saving weight types');
    }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));