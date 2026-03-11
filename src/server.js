import 'dotenv/config'
import express from 'express';
import sql from './config/database.js';
import authRoutes from './routes/auth.routes.js';
import { errorHandler, notFound } from './middleware/error.middleware.js';
import articlesRoutes from './routes/articles.routes.js';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json())

app.get('/', (req, res) => {
    res.json({message : "NEWS API is running ..."})
})

app.get('/health', async (req, res)=>{
    try{
        await sql`SELECT 1`
        res.json({status: "OK", database : 'connected'});
    }catch(err){
        res.status(503).json({status: "Service Unavailable", database : err.message});
    }
} )

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/articles', articlesRoutes);
app.get('/api/v1/categories', async (req, res) => {
  const cats = await sql`SELECT * FROM categories ORDER BY sort_order`;
  res.json({ success: true, data: cats });
});

app.use(notFound);
app.use(errorHandler);

app.listen(PORT, ()=>{
    console.log(`SERVER running on port ${PORT}`)
});
