import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const HF_TOKEN = process.env.HF_TOKEN;
const MODEL = "mistralai/Mistral-7B-Instruct-v0.2";

// 🥘 Local Meal Database
const MEALS_DB = [
  { name: "Chicken Wrap", time: 15, type: "quick", tags: ["chicken", "fast", "lunch"] },
  { name: "Egg Sandwich", time: 10, type: "breakfast", tags: ["egg", "quick", "snack"] },
  { name: "Veggie Stir Fry", time: 20, type: "healthy", tags: ["vegan", "vegetarian", "quick"] },
  { name: "Pasta Alfredo", time: 25, type: "dinner", tags: ["pasta", "creamy", "italian"] },
  { name: "Mango Smoothie", time: 5, type: "dessert", tags: ["fruit", "drink", "sweet"] },
  { name: "Chicken Biryani", time: 40, type: "main", tags: ["spicy", "rice", "indian", "chicken"] },
  { name: "Falafel Pita", time: 18, type: "vegan", tags: ["chickpeas", "snack", "quick"] },
  { name: "Paneer Butter Masala", time: 30, type: "main", tags: ["paneer", "spicy", "indian"] },
  { name: "Paneer Fried Rice", time: 20, type: "main", tags: ["paneer", "rice", "indian", "quick"] },
  { name: "Vegetable Pulao", time: 25, type: "main", tags: ["rice", "vegetarian", "indian"] },
];


// 🧩 Fuzzy string matching for typos
function levenshteinDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]) + 1;
    }
  }
  return dp[a.length][b.length];
}

function isFuzzyMatch(word, tag) {
  return tag.includes(word) || word.includes(tag) || levenshteinDistance(word, tag) <= 2;
}


// 🔍 Smarter NLP matcher
function findMealsByKeywords(message) {
  const msg = message.toLowerCase();
  const words = msg.split(/\s+/);

  // Extract ingredients from "I have ..." or fallback to all words
  let ingredients = [];
  const haveMatch = msg.match(/i have (.+)/);
  if (haveMatch) {
    ingredients = haveMatch[1]
      .split(/,|and/)
      .map((i) => i.trim())
      .filter((i) => i);
  } else {
    // If no "I have", use likely ingredient keywords
    const commonIngredients = ["chicken", "egg", "paneer", "rice", "pasta", "veg", "vegetable"];
    ingredients = words.filter((w) => commonIngredients.includes(w));
  }

  // Match meals based on tags
  let matches = MEALS_DB.filter((meal) =>
    meal.tags.some((tag) => msg.includes(tag))
  );

  // Ingredient matching (handles 1 or many)
  if (ingredients.length > 1) {
    matches = MEALS_DB.filter((meal) =>
      ingredients.every((ing) => meal.tags.includes(ing))
    );
  } else if (ingredients.length === 1) {
    matches = MEALS_DB.filter((meal) =>
      meal.tags.includes(ingredients[0])
    );
  }

  // Type-based matching ("dessert", "spicy", "snack", etc.)
  const mealTypes = ["breakfast", "lunch", "dinner", "snack", "dessert", "vegan", "spicy", "quick"];
  const typeMatch = mealTypes.find((t) => msg.includes(t));
  if (typeMatch) {
    const typeMatches = MEALS_DB.filter(
      (m) => m.type.includes(typeMatch) || m.tags.includes(typeMatch)
    );
    matches = [...new Set([...matches, ...typeMatches])];
  }

  // Time filters
  const timeMatch = msg.match(/(\d+)\s*(?:min|minutes)/);
  if (timeMatch) {
    const timeLimit = parseInt(timeMatch[1]);
    matches = matches.filter((m) => m.time <= timeLimit);
  }

  return matches;
}

// 🍽️ API fallback to TheMealDB
async function getMealsFromAPI(keyword) {
  try {
    const res = await fetch(`https://www.themealdb.com/api/json/v1/1/search.php?s=${keyword}`);
    const data = await res.json();
    return data.meals ? data.meals.slice(0, 5) : [];
  } catch (e) {
    console.error("MealDB error:", e);
    return [];
  }
}


// 💬 Main Chat Endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const { prompt } = req.body;
    const msg = prompt.toLowerCase();

    // 1️⃣ Local NLP search
    let foundMeals = findMealsByKeywords(msg);

    // 2️⃣ If no local match, fallback to API
    if (foundMeals.length === 0) {
      const keywords = ["paneer", "chicken", "egg", "rice", "dessert", "pasta", "vegan"];
      const key = keywords.find((k) => msg.includes(k));
      if (key) {
        const apiMeals = await getMealsFromAPI(key);
        if (apiMeals.length > 0) {
          const list = apiMeals.map((m) => `🍽️ ${m.strMeal}`).join("\n");
          return res.json({ reply: `Here are some ${key} dishes:\n${list}` });
        }
      }
    }

    // 3️⃣ Fallback to LLM
    if (foundMeals.length === 0) {
      const response = await fetch(`https://api-inference.huggingface.co/models/${MODEL}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${HF_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: { max_new_tokens: 150, temperature: 0.7 },
        }),
      });
      const data = await response.json();
      const output = data?.[0]?.generated_text || "Sorry, I don’t know that.";
      return res.json({ reply: output });
    }

    // 4️⃣ Return formatted results
    const list = foundMeals
      .map((m) => `🍴 ${m.name} — ⏱️ ${m.time} min (${m.type})`)
      .join("\n");
    res.json({ reply: `Here are some meal ideas:\n${list}` });

  } catch (err) {
    console.error("❌ Server Error:", err);
    res.status(500).json({ error: "Failed to fetch AI response" });
  }
});


app.listen(5000, () =>
  console.log("✅ Smart Recipe Assistant running on http://localhost:5000")
);
