
// ==========================================
// SUPABASE CONFIGURATION
// ==========================================

const SUPABASE_URL = "https://gdmcrrbpkhwgzwdelvyf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_9Jdz2SMX5OPZ91BadAqpig_Ydgul3lK";

const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

// ==========================================
// GLOBAL VARIABLES
// ==========================================

let user = null;
let records = [];

let profile = {
  starting_budget: 0,
  starting_savings: 0
};

let currentPage = 1;
const transactionsPerPage = 10;

// CHART INSTANCES
let monthlyChartInstance = null;
let expenseChartInstance = null;
let balanceChartInstance = null;

const chartColors = [
  "#929fff",
  "#42d6a4",
  "#ff7185",
  "#facc6b",
  "#b794f6",
  "#60a5fa",
  "#fb923c",
  "#a3e635",
  "#e879f9",
  "#94a3b8"
];

// ==========================================
// HELPERS
// ==========================================

function getElement(id) {
  return document.getElementById(id);
}

function getToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const values = {};

  parts.forEach(part => {
    values[part.type] = part.value;
  });

  return `${values.year}-${values.month}-${values.day}`;
}

function peso(amount) {
  return "₱" + Number(amount || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function pesoPDF(amount) {
  const value = Number(amount || 0);
  const sign = value < 0 ? "-" : "";

  return `${sign}₱${Math.abs(value).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function escapeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function message(text) {
  alert(text);
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

// ==========================================
// AUTHENTICATION
// ==========================================

async function login() {
  const email = getElement("email").value.trim();
  const password = getElement("password").value;

  if (!email || !password) {
    return message("Please enter your email and password.");
  }

  const { data, error } = await db.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    getElement("loginMessage").textContent = error.message;
    return;
  }

  user = data.user;
  await startApp();
}

async function signup() {
  const email = getElement("email").value.trim();
  const password = getElement("password").value;

  if (!email || !password) {
    return message("Please enter your email and password.");
  }

  const { data, error } = await db.auth.signUp({
    email,
    password
  });

  if (error) {
    getElement("loginMessage").textContent = error.message;
    return;
  }

  if (!data.session) {
    getElement("loginMessage").textContent =
      "Account created! Please check your email to confirm your account.";
    return;
  }

  user = data.user;
  await startApp();
}

async function logout() {
  const { error } = await db.auth.signOut();

  if (error) {
    return message(error.message);
  }

  user = null;
  records = [];

  profile = {
    starting_budget: 0,
    starting_savings: 0
  };

  destroyCharts();

  getElement("app").style.display = "none";
  getElement("login").style.display = "block";
}

async function init() {
  const { data, error } = await db.auth.getSession();

  if (error) {
    console.error(error);
    return;
  }

  if (data.session) {
    user = data.session.user;
    await startApp();
  } else {
    getElement("login").style.display = "block";
    getElement("app").style.display = "none";
  }
}

// ==========================================
// START APP
// ==========================================

async function startApp() {
  if (!user) return;

  getElement("login").style.display = "none";
  getElement("app").style.display = "block";

  await loadProfile();
  await loadRecords();

  closeForm();
  render();
}

// ==========================================
// PROFILE
// ==========================================

async function loadProfile() {
  const { data, error } = await db
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    message(error.message);
    return;
  }

  if (data) {
    profile = {
      starting_budget: Number(data.starting_budget || 0),
      starting_savings: Number(data.starting_savings || 0)
    };
  } else {
    const { error: insertError } = await db
      .from("profiles")
      .insert({
        user_id: user.id,
        starting_budget: 0,
        starting_savings: 0
      });

    if (insertError) {
      message(insertError.message);
      return;
    }

    profile = {
      starting_budget: 0,
      starting_savings: 0
    };
  }
}

async function saveProfile() {
  const { error } = await db
    .from("profiles")
    .upsert({
      user_id: user.id,
      starting_budget: Number(profile.starting_budget || 0),
      starting_savings: Number(profile.starting_savings || 0)
    }, {
      onConflict: "user_id"
    });

  if (error) {
    message(error.message);
    return false;
  }

  return true;
}

// ==========================================
// LOAD TRANSACTIONS
// ==========================================

async function loadRecords() {
  if (!user) return;

  const { data, error } = await db
    .from("transactions")
    .select("*")
    .eq("user_id", user.id)
    .order("transaction_date", { ascending: false });

  if (error) {
    message(error.message);
    return;
  }

  records = data || [];
  currentPage = 1;

  render();
}

// ==========================================
// SAVE TRANSACTION
// ==========================================

async function saveTransaction() {
  if (!user) {
    return message("Please log in first.");
  }

  const type = getElement("type").value;
  const amount = Number(getElement("amount").value);
  const description = getElement("description").value.trim();
  const date = getElement("date").value;
  const account = getElement("account").value;
  const category = getElement("category").value;
  const notes = getElement("notes").value;

  if (!amount || amount <= 0) {
    return message("Please enter a valid amount.");
  }

  if (!description) {
    return message("Please enter a description.");
  }

  if (!date) {
    return message("Please select a transaction date.");
  }

  if (!["income", "expense"].includes(type)) {
    return message("Invalid transaction type.");
  }

  if (!["budget", "savings"].includes(account)) {
    return message("Please select a valid account.");
  }

  const row = {
    user_id: user.id,
    type,
    amount,
    description,
    transaction_date: date,
    account,
    category,
    notes
  };

  const { error } = await db
    .from("transactions")
    .insert(row);

  if (error) {
    return message(error.message);
  }

  getElement("amount").value = "";
  getElement("description").value = "";
  getElement("notes").value = "";

  closeForm();

  await loadRecords();

  message("Transaction successfully saved!");
}

// ==========================================
// DELETE TRANSACTION
// ==========================================

async function deleteRecord(id) {
  if (!user) return;

  if (!confirm("Are you sure you want to delete this transaction?")) {
    return;
  }

  const { error } = await db
    .from("transactions")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return message(error.message);
  }

  await loadRecords();

  message("Transaction successfully deleted!");
}

// ==========================================
// TRANSACTION FORM
// ==========================================

function openForm(type) {
  getElement("entryCard").style.display = "block";

  getElement("type").value = type;
  getElement("date").value = getToday();

  getElement("formTitle").textContent =
    type === "income" ? "New Money In" : "New Money Out";

  getElement("accountLabel").textContent =
    type === "income"
      ? "Where will the money go?"
      : "Where will the money be deducted from?";
}

function closeForm() {
  if (getElement("entryCard")) {
    getElement("entryCard").style.display = "none";
  }
}

// ==========================================
// STARTING BALANCE SETTINGS
// ==========================================

async function settings() {
  if (!user) return;

  const budget = prompt(
    "Enter Starting Budget:",
    profile.starting_budget
  );

  if (budget === null) return;

  const savings = prompt(
    "Enter Starting Savings:",
    profile.starting_savings
  );

  if (savings === null) return;

  const budgetValue = Number(budget);
  const savingsValue = Number(savings);

  if (
    !Number.isFinite(budgetValue) ||
    !Number.isFinite(savingsValue) ||
    budgetValue < 0 ||
    savingsValue < 0
  ) {
    return message("Please enter valid starting balances.");
  }

  profile.starting_budget = budgetValue;
  profile.starting_savings = savingsValue;

  const saved = await saveProfile();

  if (saved) {
    render();
    message("Starting balances successfully updated!");
  }
}

// ==========================================
// CURRENT BALANCE
// ==========================================

async function updateCurrentBalance() {
  if (!user) return;

  const value = Number(getElement("currentBalanceInput").value);

  if (!Number.isFinite(value) || value < 0) {
    return message("Please enter a valid current balance.");
  }

  const budgetTransactions = records.filter(
    record => record.account === "budget"
  );

  let transactionNet = 0;

  budgetTransactions.forEach(record => {
    const amount = Number(record.amount || 0);

    transactionNet += record.type === "income"
      ? amount
      : -amount;
  });

  profile.starting_budget = value - transactionNet;

  const saved = await saveProfile();

  if (saved) {
    getElement("currentBalanceInput").value = "";
    render();
    message("Current balance successfully updated!");
  }
}

// ==========================================
// FILTER TRANSACTIONS
// ==========================================

function getFilteredRecords() {
  const period = getElement("period").value;
  const today = getToday();

  const fromDate = getElement("fromDate").value;
  const toDate = getElement("toDate").value;

  let filtered = [...records];

  // CUSTOM DATE RANGE
  if (fromDate && toDate) {
    return filtered.filter(record =>
      record.transaction_date >= fromDate &&
      record.transaction_date <= toDate
    );
  }

  // DAILY FILTER
  if (period === "day") {
    filtered = filtered.filter(record =>
      record.transaction_date === today
    );
  }

  // WEEKLY FILTER
  else if (period === "week") {
    const currentDate = new Date(`${today}T00:00:00`);
    const day = currentDate.getDay();
    const mondayOffset = day === 0 ? 6 : day - 1;

    const monday = new Date(currentDate);
    monday.setDate(currentDate.getDate() - mondayOffset);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const start = formatDate(monday);
    const end = formatDate(sunday);

    filtered = filtered.filter(record =>
      record.transaction_date >= start &&
      record.transaction_date <= end
    );
  }

  // MONTHLY FILTER
  else if (period === "month") {
    const month = today.slice(0, 7);

    filtered = filtered.filter(record =>
      String(record.transaction_date || "").startsWith(month)
    );
  }

  // YEARLY FILTER
  else if (period === "year") {
    const year = today.slice(0, 4);

    filtered = filtered.filter(record =>
      String(record.transaction_date || "").startsWith(year)
    );
  }

  return filtered;
}

// ==========================================
// BALANCE CALCULATIONS
// ==========================================

function getBalances() {
  let budget = Number(profile.starting_budget || 0);
  let savings = Number(profile.starting_savings || 0);

  records.forEach(record => {
    const amount = Number(record.amount || 0);

    const adjustment = record.type === "income"
      ? amount
      : -amount;

    if (record.account === "budget") {
      budget += adjustment;
    } else if (record.account === "savings") {
      savings += adjustment;
    }
  });

  return {
    budget,
    savings
  };
}

// ==========================================
// PAGINATION
// ==========================================

function changePage(direction) {
  const filtered = getFilteredRecords();

  const totalPages = Math.max(
    1,
    Math.ceil(filtered.length / transactionsPerPage)
  );

  currentPage += direction;

  currentPage = Math.max(
    1,
    Math.min(currentPage, totalPages)
  );

  render();
}

// ==========================================
// CHART HELPERS
// ==========================================

function getLastSixMonths() {
  const [year, month] = getToday().split("-").map(Number);
  const months = [];

  for (let i = 5; i >= 0; i--) {
    const date = new Date(year, month - 1 - i, 1);

    const monthYear = date.getFullYear();
    const monthNumber = String(date.getMonth() + 1).padStart(2, "0");

    months.push({
      key: `${monthYear}-${monthNumber}`,
      label: date.toLocaleDateString("en-PH", {
        month: "short",
        year: "2-digit"
      })
    });
  }

  return months;
}

function destroyCharts() {
  if (monthlyChartInstance) {
    monthlyChartInstance.destroy();
    monthlyChartInstance = null;
  }

  if (expenseChartInstance) {
    expenseChartInstance.destroy();
    expenseChartInstance = null;
  }

  if (balanceChartInstance) {
    balanceChartInstance.destroy();
    balanceChartInstance = null;
  }
}

// ==========================================
// CHART 1: MONTHLY INCOME VS EXPENSES
// ==========================================

function renderMonthlyChart() {
  const canvas = getElement("monthlyChart");
  if (!canvas) return;

  const months = getLastSixMonths();

  const incomeData = [];
  const expenseData = [];

  months.forEach(month => {
    const monthRecords = records.filter(record =>
      String(record.transaction_date || "").startsWith(month.key)
    );

    const income = monthRecords
      .filter(record => record.type === "income")
      .reduce((sum, record) => sum + Number(record.amount || 0), 0);

    const expenses = monthRecords
      .filter(record => record.type === "expense")
      .reduce((sum, record) => sum + Number(record.amount || 0), 0);

    incomeData.push(income);
    expenseData.push(expenses);
  });

  const data = {
    labels: months.map(month => month.label),

    datasets: [
      {
        label: "Money In",
        data: incomeData,
        backgroundColor: "#42d6a4",
        borderRadius: 6
      },
      {
        label: "Money Out",
        data: expenseData,
        backgroundColor: "#ff7185",
        borderRadius: 6
      }
    ]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,

    interaction: {
      mode: "index",
      intersect: false
    },

    plugins: {
      legend: {
        labels: {
          color: "#eef2ff"
        }
      },

      tooltip: {
        callbacks: {
          label: context =>
            `${context.dataset.label}: ${peso(context.raw)}`
        }
      }
    },

    scales: {
      x: {
        ticks: {
          color: "#91a0bb"
        },
        grid: {
          display: false
        }
      },

      y: {
        beginAtZero: true,
        ticks: {
          color: "#91a0bb",
          callback: value => "₱" + Number(value).toLocaleString("en-PH")
        },
        grid: {
          color: "rgba(145,160,187,0.12)"
        }
      }
    }
  };

  if (monthlyChartInstance) {
    monthlyChartInstance.data = data;
    monthlyChartInstance.update();
  } else {
    monthlyChartInstance = new Chart(canvas, {
      type: "bar",
      data,
      options
    });
  }
}

// ==========================================
// CHART 2: EXPENSE BREAKDOWN
// ==========================================

function renderExpenseChart() {
  const canvas = getElement("expenseChart");
  if (!canvas) return;

  const filtered = getFilteredRecords();

  const expenses = filtered.filter(record =>
    record.type === "expense"
  );

  const categories = {};

  expenses.forEach(record => {
    const category = record.category || "Other";

    categories[category] =
      (categories[category] || 0) + Number(record.amount || 0);
  });

  let labels = Object.keys(categories);
  let values = Object.values(categories);

  const hasExpenses = labels.length > 0;

  if (!hasExpenses) {
    labels = ["No expenses yet"];
    values = [1];
  }

  const data = {
    labels,

    datasets: [
      {
        data: values,

        backgroundColor: hasExpenses
          ? labels.map((_, index) =>
              chartColors[index % chartColors.length]
            )
          : ["#293650"],

        borderColor: "#141d31",
        borderWidth: 3,
        hoverOffset: 10
      }
    ]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "65%",

    plugins: {
      legend: {
        position: "bottom",

        labels: {
          color: "#eef2ff",
          padding: 15,
          usePointStyle: true
        }
      },

      tooltip: {
        callbacks: {
          label: context => {
            if (!hasExpenses) {
              return "No expenses yet";
            }

            return `${context.label}: ${peso(context.raw)}`;
          }
        }
      }
    }
  };

  if (expenseChartInstance) {
    expenseChartInstance.data = data;
    expenseChartInstance.update();
  } else {
    expenseChartInstance = new Chart(canvas, {
      type: "doughnut",
      data,
      options
    });
  }
}

// ==========================================
// CHART 3: BALANCE TREND
// ==========================================

function renderBalanceChart() {
  const canvas = getElement("balanceChart");
  if (!canvas) return;

  const months = getLastSixMonths();
  const todayMonth = getToday().slice(0, 7);
  const firstMonth = months[0].key;

  let budget = Number(profile.starting_budget || 0);
  let savings = Number(profile.starting_savings || 0);

  // Start with transactions before the displayed period.
  records.forEach(record => {
    const monthKey = String(record.transaction_date || "").slice(0, 7);

    if (!monthKey || monthKey >= firstMonth || monthKey > todayMonth) {
      return;
    }

    const amount = Number(record.amount || 0);
    const adjustment = record.type === "income" ? amount : -amount;

    if (record.account === "budget") {
      budget += adjustment;
    } else if (record.account === "savings") {
      savings += adjustment;
    }
  });

  const budgetData = [];
  const savingsData = [];

  months.forEach(month => {
    if (month.key <= todayMonth) {
      const monthRecords = records
        .filter(record =>
          String(record.transaction_date || "").startsWith(month.key)
        )
        .sort((a, b) =>
          String(a.transaction_date).localeCompare(String(b.transaction_date))
        );

      monthRecords.forEach(record => {
        const amount = Number(record.amount || 0);
        const adjustment = record.type === "income" ? amount : -amount;

        if (record.account === "budget") {
          budget += adjustment;
        } else if (record.account === "savings") {
          savings += adjustment;
        }
      });

      budgetData.push(budget);
      savingsData.push(savings);
    } else {
      budgetData.push(null);
      savingsData.push(null);
    }
  });

  const data = {
    labels: months.map(month => month.label),

    datasets: [
      {
        label: "Current Budget",
        data: budgetData,
        borderColor: "#929fff",
        backgroundColor: "rgba(146,159,255,0.12)",
        fill: true,
        tension: 0.35,
        pointRadius: 4
      },
      {
        label: "Savings",
        data: savingsData,
        borderColor: "#42d6a4",
        backgroundColor: "rgba(66,214,164,0.10)",
        fill: true,
        tension: 0.35,
        pointRadius: 4
      }
    ]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,

    interaction: {
      mode: "index",
      intersect: false
    },

    plugins: {
      legend: {
        labels: {
          color: "#eef2ff"
        }
      },

      tooltip: {
        callbacks: {
          label: context =>
            `${context.dataset.label}: ${peso(context.raw)}`
        }
      }
    },

    scales: {
      x: {
        ticks: {
          color: "#91a0bb"
        },
        grid: {
          display: false
        }
      },

      y: {
        ticks: {
          color: "#91a0bb",
          callback: value => "₱" + Number(value).toLocaleString("en-PH")
        },
        grid: {
          color: "rgba(145,160,187,0.12)"
        }
      }
    }
  };

  if (balanceChartInstance) {
    balanceChartInstance.data = data;
    balanceChartInstance.update();
  } else {
    balanceChartInstance = new Chart(canvas, {
      type: "line",
      data,
      options
    });
  }
}

// ==========================================
// UPDATE ALL CHARTS
// ==========================================

function renderCharts() {
  if (typeof Chart === "undefined") {
    console.error(
      "Chart.js is not loaded. Add the Chart.js CDN before app.js."
    );
    return;
  }

  renderMonthlyChart();
  renderExpenseChart();
  renderBalanceChart();
}

// ==========================================
// DASHBOARD AND TABLE RENDER
// ==========================================

function render() {
  if (!user) return;

  const filtered = getFilteredRecords();
  const balances = getBalances();

  // BALANCES
  getElement("budgetBalance").textContent = peso(balances.budget);
  getElement("savingsBalance").textContent = peso(balances.savings);

  // TOTAL IN AND OUT FOR SELECTED FILTER
  const income = filtered
    .filter(record => record.type === "income")
    .reduce((sum, record) => sum + Number(record.amount || 0), 0);

  const expenses = filtered
    .filter(record => record.type === "expense")
    .reduce((sum, record) => sum + Number(record.amount || 0), 0);

  getElement("incomeTotal").textContent = peso(income);
  getElement("expenseTotal").textContent = peso(expenses);

  // REPORT SUMMARY
  const period = getElement("period").value;

  const filterLabels = {
    day: "Daily",
    week: "Weekly",
    month: "Monthly",
    year: "Yearly",
    all: "All Records"
  };

  const filterLabel =
    getElement("fromDate").value && getElement("toDate").value
      ? `${getElement("fromDate").value} to ${getElement("toDate").value}`
      : filterLabels[period];

  getElement("reportSummary").textContent =
    `Report: ${filterLabel} | Money In ${peso(income)} | Money Out ${peso(expenses)} | Net ${peso(income - expenses)}`;

  // PAGINATION
  const totalPages = Math.max(
    1,
    Math.ceil(filtered.length / transactionsPerPage)
  );

  currentPage = Math.min(currentPage, totalPages);
  currentPage = Math.max(currentPage, 1);

  const startIndex =
    (currentPage - 1) * transactionsPerPage;

  const paginatedRecords = filtered.slice(
    startIndex,
    startIndex + transactionsPerPage
  );

  // TABLE DISPLAY
  getElement("records").innerHTML = paginatedRecords.map(record => {
    const amount = Number(record.amount || 0);

    const typeLabel =
      record.type === "income" ? "Money In" : "Money Out";

    const amountClass =
      record.type === "income" ? "green" : "red";

    const amountSign =
      record.type === "income" ? "+" : "-";

    return `
      <tr>
        <td>${escapeText(record.transaction_date || "")}</td>

        <td>${escapeText(record.description || "")}</td>

        <td>${escapeText(record.category || "")}</td>

        <td>
          ${record.account === "budget"
            ? "Current Budget"
            : "Savings"}
        </td>

        <td class="${amountClass}">
          ${typeLabel}
        </td>

        <td class="${amountClass}">
          ${amountSign}${peso(amount)}
        </td>

        <td class="no-print">
          <button
            class="secondary"
            onclick="deleteRecord('${escapeText(record.id)}')">
            Delete
          </button>
        </td>
      </tr>
    `;
  }).join("");

  // EMPTY TABLE MESSAGE
  if (paginatedRecords.length === 0) {
    getElement("records").innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center;padding:25px;color:#91a0bb">
          No transactions found.
        </td>
      </tr>
    `;
  }

  // PAGINATION INFO
  const firstTransaction =
    filtered.length === 0 ? 0 : startIndex + 1;

  const lastTransaction = Math.min(
    startIndex + transactionsPerPage,
    filtered.length
  );

  getElement("pageInfo").textContent =
    `Showing ${firstTransaction}-${lastTransaction} of ${filtered.length} transactions · Page ${currentPage} of ${totalPages}`;

  getElement("prevPage").disabled = currentPage <= 1;
  getElement("nextPage").disabled = currentPage >= totalPages;

  // REFRESH CHARTS
  renderCharts();
}

// ==========================================
// PDF FONT LOADER
// ==========================================

async function loadPesoFont(doc) {
  const fontFile = "NotoSans-VariableFont_wdth,wght.ttf";
  const fontPath = `Fonts/${fontFile}`;

  const response = await fetch(fontPath);

  if (!response.ok) {
    throw new Error(
      `Font not found: ${fontPath}. Check your Fonts folder and filename.`
    );
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  let binary = "";

  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  const base64 = btoa(binary);

  doc.addFileToVFS(fontFile, base64);
  doc.addFont(fontFile, "NotoSans", "normal");
}

// ==========================================
// DOWNLOAD PDF
// ==========================================

async function downloadPDF() {
  if (!user) {
    return message("Please log in first.");
  }

  try {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      throw new Error("jsPDF library is not loaded.");
    }

    const { jsPDF } = window.jspdf;

    const doc = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: [330.2, 215.9],
      compress: true
    });

    await loadPesoFont(doc);

    const filtered = getFilteredRecords();
    const balances = getBalances();

    const income = filtered
      .filter(record => record.type === "income")
      .reduce((sum, record) => sum + Number(record.amount || 0), 0);

    const expenses = filtered
      .filter(record => record.type === "expense")
      .reduce((sum, record) => sum + Number(record.amount || 0), 0);

    const period = getElement("period").value;

    const filterLabels = {
      day: "Daily",
      week: "Weekly",
      month: "Monthly",
      year: "Yearly",
      all: "All Records"
    };

    const filterLabel =
      getElement("fromDate").value && getElement("toDate").value
        ? `${getElement("fromDate").value} to ${getElement("toDate").value}`
        : filterLabels[period];

    // PDF HEADER
    doc.setFont("NotoSans", "normal");
    doc.setFontSize(18);
    doc.text("MY PERSONAL FINANCE", 14, 16);

    doc.setFontSize(10);
    doc.text(`Expense Report - ${filterLabel}`, 14, 23);
    doc.text(`Generated: ${getToday()}`, 14, 29);

    // BALANCE SUMMARY
    doc.setFontSize(11);

    doc.text(
      `Current Budget: ${pesoPDF(balances.budget)}`,
      14,
      40
    );

    doc.text(
      `Savings Balance: ${pesoPDF(balances.savings)}`,
      14,
      47
    );

    doc.text(
      `Money In: ${pesoPDF(income)}`,
      125,
      40
    );

    doc.text(
      `Money Out: ${pesoPDF(expenses)}`,
      125,
      47
    );

    doc.text(
      `Net: ${pesoPDF(income - expenses)}`,
      235,
      40
    );

    // TABLE ROWS
    const tableRows = filtered.map(record => [
      String(record.transaction_date || ""),
      String(record.description || ""),
      String(record.category || ""),
      record.account === "budget"
        ? "Current Budget"
        : "Savings",
      record.type === "income"
        ? "Money In"
        : "Money Out",
      `${record.type === "income" ? "+" : "-"}${pesoPDF(record.amount)}`
    ]);

    // PDF TABLE
    if (typeof doc.autoTable !== "function") {
      throw new Error("jsPDF AutoTable plugin is not loaded.");
    }

    doc.autoTable({
      startY: 55,

      head: [[
        "Date",
        "Description",
        "Category",
        "Account",
        "Type",
        "Amount"
      ]],

      body: tableRows,

      theme: "grid",

      styles: {
        font: "NotoSans",
        fontStyle: "normal",
        fontSize: 9,
        cellPadding: 3,
        textColor: [40, 40, 40],
        lineColor: [220, 220, 220],
        lineWidth: 0.1
      },

      headStyles: {
        fillColor: [35, 48, 75],
        textColor: [255, 255, 255],
        font: "NotoSans",
        fontStyle: "normal"
      },

      columnStyles: {
        0: { cellWidth: 32 },
        1: { cellWidth: 75 },
        2: { cellWidth: 40 },
        3: { cellWidth: 45 },
        4: { cellWidth: 40 },
        5: { cellWidth: 45, halign: "right" }
      },

      didParseCell: function(data) {
        if (data.section !== "body") return;

        const rowType = data.row.raw[4];

        if (data.column.index === 4 || data.column.index === 5) {
          data.cell.styles.fontStyle = "normal";

          data.cell.styles.textColor =
            rowType === "Money In"
              ? [22, 163, 74]
              : rowType === "Money Out"
                ? [220, 38, 38]
                : [40, 40, 40];
        }
      },

      margin: {
        top: 12,
        right: 14,
        bottom: 15,
        left: 14
      }
    });

    // FOOTER
    const pageCount = doc.internal.getNumberOfPages();

    for (let page = 1; page <= pageCount; page++) {
      doc.setPage(page);
      doc.setFont("NotoSans", "normal");
      doc.setFontSize(8);

      doc.text(
        `Page ${page} of ${pageCount}`,
        doc.internal.pageSize.getWidth() - 14,
        doc.internal.pageSize.getHeight() - 7,
        { align: "right" }
      );
    }

    doc.save("Expense-Report.pdf");

  } catch (error) {
    console.error("PDF Error:", error);
    message("Unable to generate PDF: " + error.message);
  }
}

// ==========================================
// INITIALIZE APP
// ==========================================

init();
