const express = require('express');
const router = express.Router();
const pool = require('../db');

router.get('/new', (req, res) => {
  res.render('member_form');
});

router.post('/new', async (req, res) => {
  const { name, email, phone } = req.body;

  await pool.query(
    `INSERT INTO members (name, email, phone)
     VALUES ($1, $2, $3)`,
    [name, email, phone]
  );

  res.redirect('/');
});

module.exports = router;
