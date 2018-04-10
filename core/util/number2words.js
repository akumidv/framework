'use strict';
// jscs:disable disallowImplicitTypeConversion

let words = [
  [
    '', 'один', 'два', 'три', 'четыре', 'пять', 'шесть',
    'семь', 'восемь', 'девять', 'десять', 'одиннадцать',
    'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать',
    'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'
  ],
  [
    '', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят',
    'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'
  ],
  [
    '', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот',
    'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'
  ]
];

let rusRubles = ['рубль', 'рубля', 'рублей'];

function plural(count, options) {
  if (options.length !== 3) {
    return false;
  }

  count = Math.abs(count) % 100;
  let rest = count % 10;

  if (count > 10 && count < 20) {
    return options[2];
  }

  if (rest > 1 && rest < 5) {
    return options[1];
  }

  if (rest === 1) {
    return options[0];
  }

  return options[2];
};

function parseNumber(number, count, isCurr) {
  let first;
  let second;
  let numeral = '';

  if (number.length === 3) {
    first = number.substr(0, 1);
    number = number.substr(1, 3);
    numeral = '' + words[2][first] + ' ';
  }

  if (number < 20) {
    numeral = numeral + words[0][parseFloat(number)] + ' ';
  } else {
    first = number.substr(0, 1);
    second = number.substr(1, 2);
    numeral = numeral + words[1][first] + ' ' + words[0][second] + ' ';
  }

  if (count === 0 && isCurr) {
    numeral = numeral + plural(number, rusRubles);
  } else if (count === 1) {
    if (numeral !== '  ') {
      numeral = numeral + plural(number, ['тысяча ', 'тысячи ', 'тысяч ']);
      numeral = numeral.replace('один ', 'одна ').replace('два ', 'две ');
    }
  } else if (count === 2) {
    if (numeral !== '  ') {
      numeral = numeral + plural(number, ['миллион ', 'миллиона ', 'миллионов ']);
    }
  } else if (count === 3) {
    numeral = numeral + plural(number, ['миллиард ', 'миллиарда ', 'миллиардов ']);
  }

  return numeral;
}

function parseDecimals(number) {
  number = '' + number;
  let text = plural(number, ['копейка', 'копейки', 'копеек']);

  if (number == 0) {
    number = 'ноль';
  } else {
    let first = number.substr(0, 1);
    let second = number.substr(1, 2);
    number = words[1][first];
    number += number ? ' ' : '';
    if (second == 1) {
      number += 'одна';
    } else if (second == 2) {
      number += 'две';
    } else {
      number += words[0][second];
    }
  }

  return ' ' + number + ' ' + text;
}

function rubles(number, isCurr) {
  if (!number) {
    return false;
  }

  let type = typeof number;
  if (type !== 'number' && type !== 'string') {
    return false;
  }

  if (type === 'string') {
    number = parseFloat(number.replace(',', '.'));

    if (isNaN(number)) {
      return false;
    }
  }

  if (number <= 0) {
    return false;
  }

  let splt;
  let decimals;

  number = number.toFixed(2);
  if (number.indexOf('.') !== -1) {
    splt = number.split('.');
    number = splt[0];
    decimals = splt[1];
  }

  let numeral = '';
  let length = number.length - 1;
  let parts = '';
  let count = 0;
  let digit;

  while (length >= 0) {
    digit = number.substr(length, 1);
    parts = digit + parts;

    if ((parts.length === 3 || length === 0) && !isNaN(parseFloat(parts))) {
      numeral = parseNumber(parts, count, isCurr) + numeral;
      parts = '';
      count++;
    }

    length--;
  }

  numeral = numeral.replace(/\s+/g, ' ');

  if (decimals && isCurr) {
    numeral = numeral + parseDecimals(parseFloat(decimals));
  }

  return numeral;
}

module.exports = rubles;
