// jscs:disable requireCapitalizedComments

/**
 * Created by kras on 25.02.16.
 */
'use strict';

const DataSource = require('core/interfaces/DataSource');
const mongo = require('mongodb');
const client = mongo.MongoClient;
const LoggerProxy = require('core/impl/log/LoggerProxy');
const empty = require('core/empty');
const clone = require('clone');
const cuid = require('cuid');
const IonError = require('core/IonError');
const Errors = require('core/errors/data-source');
const Iterator = require('core/interfaces/Iterator');
const moment = require('moment');

const AUTOINC_COLLECTION = '__autoinc';
const GEOFLD_COLLECTION = '__geofields';

const excludeFromRedactfilter = ['$text', '$geoIntersects', '$geoWithin', '$regex', '$options', '$where'];
const excludeFromPostfilter = ['$text', '$geoIntersects', '$geoWithin', '$where'];
const IGNORE = '____$$$ignore$$$___$$$me$$$___';

// jshint maxstatements: 100, maxcomplexity: 50, maxdepth: 10

/**
 * @param {{ uri: String, options: Object }} config
 * @constructor
 */
function MongoDs(config) {

  var _this = this;

  /**
   * @type {Db}
   */
  this.db = null;

  this.isOpen = false;

  this.busy = false;

  var log = config.logger || new LoggerProxy();

  var excludeNullsFor = {};

  function wrapError(err, oper, coll) {
    if (err.name === 'MongoError') {
      if (err.code === 11000 || err.code === 11001) {
        try {
          let p = err.message.match(/\s+index:\s+([^\s_]+)_\d+\s+dup key:\s*{\s*:\s*([^}]*)\s*}/i);
          if (!p) {
            p = err.message.match(/\s+index:\s+([\w_]+)\s+dup key:\s*{\s*:\s*([^}]*)\s*}/i);
          }
          let key = [];
          let keyMatch = p && p[1] || '';
          if (keyMatch) {
            keyMatch = keyMatch.split('_');
            keyMatch.forEach(k => {
              k = k.trim();
              if (!/^\d+$/i.test(k)) {
                key.push(k);
              }
            });
          }
          let value = [];
          let valueMatch = p && p[2] || null;
          if (valueMatch) {
            let vm = valueMatch.match(/"(\S*)"/ig);
            if (vm) {
              vm.forEach(v => value.push(v.trim().replace(/^"/, '').replace(/"$/, '')));
            } else {
              vm = valueMatch.match(/(\S*)/ig);
              if (vm) {
                vm.forEach(v => value.push(v));
              }
            }
          }
          let params = {key: key, table: coll, value};
          return new IonError(Errors.UNIQUENESS_VIOLATION, params, err);
        } catch (e) {
          return new IonError(Errors.OPER_FAILED, {oper: oper, table: coll}, e);
        }
      }
    }
    return new IonError(Errors.OPER_FAILED, {oper: oper, table: coll}, err);
  }

  function registerFunction(c, nm, f) {
    return function () {
      return new Promise(function (resolve, reject) {
        c.updateOne(
          {
            _id: nm
          },
          {
            value: new mongo.Code(f)
          },
          {
            upsert: true
          },
          function (err) {
            return err ? reject(err) : resolve();
          }
        );
      });
    };
  }

  /**
   * @param {{}} funcs
   * @returns {Promise}
   */
  function registerFunctions(funcs) {
    return new Promise(function (resolve, reject) {
      _this.db.collection('system.js', {}, function (err, c) {
        if (err) {
          return reject(err);
        }

        var p;
        for (let nm in funcs) {
          if (funcs.hasOwnProperty(nm)) {
            if (p) {
              p = p.then(registerFunction(c, nm, funcs[nm]));
            } else {
              p = registerFunction(c, nm, funcs[nm])();
            }
          }
        }
        if (p) {
          p.then(resolve).catch(reject);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * @returns {Promise}
   */
  function openDb() {
    return new Promise(function (resolve, reject) {
      if (_this.db && _this.isOpen) {
        return resolve(_this.db);
      } else if (_this.db && _this.busy) {
        _this.db.once('isOpen', function () {
          resolve(_this.db);
        });
      } else {
        _this.busy = true;
        client.connect(config.uri, config.options, function (err, db) {
          if (err) {
            reject(err);
          }
          try {
            _this.db = db;
            _this.busy = false;
            _this.isOpen = true;
            log.info('Получено соединение с базой: ' + db.s.databaseName);
            _this._ensureIndex(AUTOINC_COLLECTION, {__type: 1}, {unique: true})
                .then(
                  function () {
                    return _this._ensureIndex(GEOFLD_COLLECTION, {__type: 1}, {unique: true});
                  }
                )
                .then(
                  function () {
                    return registerFunctions({
                      dateAdd: function (d, v, p) {
                        p = p || 'd';
                        var result = new Date(d);
                        switch (p) {
                          case 'd': result.setDate(d.getDate() + v); break;
                          case 'm': result.setMonth(d.getMonth() + v); break;
                          case 'y': result.setFullYear(d.getFullYear() + v); break;
                          case 'h': result.setHours(d.getHours()); break;
                          case 'min': result.setMinutes(d.getMinutes() + v); break;
                          case 'sec': result.setSeconds(d.getSeconds() + v); break;
                        }
                        return result;
                      },
                      date: function () {
                        if (!arguments.length) {
                          return Date();
                        }
                        return new Function.prototype.bind.apply(Date, arguments.slice(0).unshift(null));
                      }
                    });
                  }
                )
                .then(
                  function () {
                    resolve(_this.db);
                    _this.db.emit('isOpen', _this.db);
                  }
                ).catch(reject);
          } catch (e) {
            _this.busy = false;
            _this.isOpen = false;
            reject(e);
          }
        });
      }
    });
  }

  this._connection = function () {
    if (this.isOpen) {
      return this.db;
    }
    return null;
  };

  this._open = function () {
    return openDb();
  };

  this._close = function () {
    return new Promise(function (resolve, reject) {
      if (_this.db && _this.isOpen) {
        _this.busy = true;
        _this.db.close(true, function (err) {
          _this.isOpen = false;
          _this.busy = false;
          if (err) {
            reject(wrapError(err));
          } else {
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  };

  /**
   * @param {String} type
   * @returns {Promise}
   */
  function getCollection(type) {
    return openDb()
      .then(function () {
        // Здесь мы перехватываем автосоздание коллекций, чтобы вставить хук для создания индексов, например
        return new Promise(function (resolve, reject) {
          _this.db.collection(type, {strict: true}, function (err, c) {
            if (!c) {
              try {
                _this.db.createCollection(type)
                  .then(resolve)
                  .catch(e => reject(wrapError(err, 'create', type)));
              } catch (e) {
                return reject(e);
              }
            } else {
              if (err) {
                return reject(wrapError(err, 'open', type));
              }
              resolve(c);
            }
          });
        });
      });
  }

  function getAutoInc(type) {
    return getCollection(AUTOINC_COLLECTION).then(
      /**
       * @param {Collection} autoinc
       */
      function (autoinc) {
        return new Promise((resolve, reject) => {
          autoinc.find({__type: type})
            .limit(1)
            .next((err, counters) => {
              if (err) {
                return reject(err);
              }
              resolve({ai: autoinc, c: counters});
            });
        });
      }
    );
  }

  function autoInc(type, data) {
    return getAutoInc(type).then(
        /**
         * @param {{ai: Collection, c: {counters:{}, steps:{}}}} result
         */
        function (result) {
          if (result && result.c && result.c.counters) {
            var inc = {};
            var act = false;
            var counters = result.c.counters;
            for (var nm in counters) {
              if (counters.hasOwnProperty(nm)) {
                inc['counters.' + nm] =
                  result.c.steps && result.c.steps.hasOwnProperty(nm) ? result.c.steps[nm] : 1;
                act = true;
              }
            }

            if (act) {
              return new Promise((resolve, reject) => {
                result.ai.findOneAndUpdate(
                  {__type: type},
                  {$inc: inc},
                  {returnOriginal: false, upsert: false},
                  function (err, result) {
                    if (err) {
                      return reject(err);
                    }
                    for (var nm in result.value.counters) {
                      if (result.value.counters.hasOwnProperty(nm)) {
                        data[nm] = result.value.counters[nm];
                      }
                    }
                    resolve(data);
                  });
              });
            }
          }
          return Promise.resolve(data);
        }
      );
  }

  function excludeNulls(data, excludes) {
    var nm;
    var unsets = {};
    for (nm in data) {
      if (data.hasOwnProperty(nm)) {
        if (data[nm] === null && excludes.hasOwnProperty(nm)) {
          delete data[nm];
          unsets[nm] = true;
        }
      }
    }
    return {data: data, unset: unsets};
  }

  /**
   * @param {Collection} c
   * @returns {Promise}
   */
  function cleanNulls(c, type, data) {
    if (excludeNullsFor.hasOwnProperty(type)) {
      return Promise.resolve(excludeNulls(data, excludeNullsFor[type]));
    }
    return new Promise(
      function (resolve, reject) {
        c.indexes(function (err, indexes) {
          if (err) {
            return reject(err);
          }
          var excludes = {};
          for (let i = 0; i < indexes.length; i++) {
            if (indexes[i].unique && indexes[i].sparse) {
              for (let nm in indexes[i].key) {
                if (indexes[i].key.hasOwnProperty(nm)) {
                  excludes[nm] = true;
                }
              }
            }
          }

          excludeNullsFor[type] = excludes;
          resolve(excludeNulls(data, excludeNullsFor[type]));
        });
      }
    );
  }

  function prepareGeoJSON(data) {
    var tmp, tmp2, i;
    for (var nm in data) {
      if (data.hasOwnProperty(nm)) {
        if (typeof data[nm] === 'object' && data[nm] && data[nm].type && (data[nm].geometry || data[nm].features)) {
          switch (data[nm].type) {
            case 'Feature': {
              tmp = clone(data[nm], true);
              delete tmp.geometry;
              data[nm] = data[nm].geometry;
              data['__geo__' + nm + '_f'] = tmp;
            }
              break;
            case 'FeatureCollection': {
              tmp = {
                type: 'GeometryCollection',
                geometries: []
              };
              tmp2 = clone(data[nm], true);

              for (i = 0; i < tmp2.features.length; i++) {
                tmp.geometries.push(tmp2.features[i].geometry);
                delete tmp2.features[i].geometry;
              }
              data[nm] = tmp;
              data['__geo__' + nm + '_f'] = tmp2;
            }
              break;
          }
        }
      }
    }
    return data;
  }

  this._insert = function (type, data, opts) {
    var options = opts || {};
    return getCollection(type).then(
      function (c) {
        return autoInc(type, data)
            .then(
              function (data) {
                return cleanNulls(c, type, prepareGeoJSON(data));
              }
            ).then(
              function (data) {
                return new Promise(function (resolve, reject) {
                  c.insertOne(clone(data.data), function (err, result) {
                    if (err) {
                      reject(wrapError(err, 'insert', type));
                    } else if (result.insertedId) {
                      if (options.skipResult) {
                        return resolve(result);
                      }
                      _this._get(type, {_id: result.insertedId}, {}).then(resolve).catch(reject);
                    } else {
                      reject(new IonError(Errors.OPER_FAILED, {oper: 'insert', table: type}));
                    }
                  });
                });
              }
            );
      }
    );
  };

  function adjustAutoInc(type, data) {
    if (!data) {
      return Promise.resolve();
    }
    return getAutoInc(type).then(
        /**
         * @param {{ai: Collection, c: {counters:{}, steps:{}}}} result
         */
        function (result) {
          var act = false;
          var up = {};
          if (result && result.c && result.c.counters) {
            var counters = result.c.counters;
            for (let nm in counters) {
              if (counters.hasOwnProperty(nm)) {
                if (data && data.hasOwnProperty(nm) && counters[nm] < data[nm]) {
                  up['counters.' + nm] = data[nm];
                  act = true;
                }
              }
            }
          }
          if (!act) {
            return Promise.resolve(data);
          }
          return new Promise((resolve, reject) => {
            result.ai.findOneAndUpdate(
              {__type: type},
              {$set: up},
              {returnOriginal: false, upsert: false},
              function (err) {
                return err ? reject(err) : resolve(data);
              }
            );
          });
        }
      );
  }

  function prepareConditions(conditions, part, parent, nottop, part2, parent2) {
    if (Array.isArray(conditions)) {
      for (let i = 0; i < conditions.length; i++) {
        prepareConditions(conditions[i], i, conditions, false, part, parent);
      }
    } else if (typeof conditions === 'object' && conditions) {
      for (let nm in conditions) {
        if (conditions.hasOwnProperty(nm)) {
          if (nm === '_id' && typeof conditions._id === 'string') {
            conditions._id = new mongo.ObjectID(conditions._id);
          } else if (nm === '$not' && nottop !== true) {
            let tmp = prepareConditions(conditions[nm], nm, conditions, true, part, parent);
            conditions.$nor = Array.isArray(tmp) ? tmp : [tmp];
            delete conditions[nm];
          } else if (nm === '$empty') {
            if (parent && part) {
              let tmp = conditions[nm] ? '$or' : '$nor';
              delete parent[part];
              parent[tmp] = [];
              let tmp2 = {};
              tmp2[part] = {$eq: ''};
              parent[tmp].push(tmp2);
              tmp2 = {};
              tmp2[part] = {$eq: null};
              parent[tmp].push(tmp2);
              tmp2 = {};
              tmp2[part] = {$exists: false};
              parent[tmp].push(tmp2);
            }
          } else if (nm === '$date') {
            let v = '';
            let f = '';
            if (Array.isArray(conditions[nm])) {
              if (conditions[nm].length > 2) {
                v =  conditions[nm];
              } else {
                if (conditions[nm].length > 0) {
                  v = conditions[nm][0];
                }
                if (typeof v === 'string' && conditions[nm].length > 1) {
                  f = conditions[nm][1];
                }
              }
            } else {
              v = conditions[nm];
            }

            if (!v) {
              parent[part] = new Date();
            } else if (v === 'today') {
              parent[part] = new Date();
              parent[part].setHours(0, 0, 0);
            } else if (Array.isArray(v)) {
              parent[part] = new Function.prototype.bind.apply(Date, v.slice(0).unshift(null));
            } else {
              if (f) {
                parent[part] = moment(v, f).toDate();
              } else {
                parent[part] = moment(v).toDate();
              }
            }
            break;
          } else if (nm === '$dateAdd') {
            let args = [];
            for (let k = 0; k < conditions[nm].length; k++) {
              if (conditions[nm][k][0] === '$') {
                args.push(conditions[nm][k].replace(/^\$/, 'this.'));
              } else {
                if (isNaN(conditions[nm][k])) {
                  args.push('"' + conditions[nm][k] + '"');
                } else {
                  args.push(conditions[nm][k]);
                }
              }
            }
            if (parent2) {
              delete parent2[part2];
              parent2.$where = 'this.' + part2;
              switch (part) {
                case '$eq': parent2.$where = parent2.$where + ' == '; break;
                case '$ne': parent2.$where = parent2.$where + ' != '; break;
                case '$lt': parent2.$where = parent2.$where + ' < '; break;
                case '$gt': parent2.$where = parent2.$where + ' > '; break;
                case '$lte': parent2.$where = parent2.$where + ' <= '; break;
                case '$gte': parent2.$where = parent2.$where + ' >= '; break;
              }
              parent2.$where = parent2.$where + 'dateAdd(' + args.join(', ') + ')';
            } else if (parent) {
              delete parent[part];
              parent.$where = 'this.' + part + ' = dateAdd(' + args.join(', ') + ')';
            } else {
              throw new Error('Ошибка в синтаксисе условий запроса.');
            }
          } else if (nm === '$joinExists') {
            if (conditions[nm].filter) {
              prepareConditions(conditions[nm].filter, 'filter', conditions[nm], false, part, parent);
            }
          } else {
            prepareConditions(conditions[nm], nm, conditions, true, part, parent);
          }
        }
      }
    }
    return conditions;
  }

  /**
   * @param {String} type
   * @param {{}} conditions
   * @param {{}} data
   * @param {{}} options
   * @param {Boolean} options.upsert
   * @param {Boolean} options.bulk
   * @param {Boolean} options.skipResult
   * @returns {Promise}
     */
  function doUpdate(type, conditions, data, options) {
    var hasData = false;
    if (data) {
      for (var nm in data) {
        if (data.hasOwnProperty(nm) &&
          typeof data[nm] !== 'undefined' &&
          typeof data[nm] !== 'function'
        ) {
          hasData = nm;
          break;
        }
      }
    }

    if (!hasData) {
      if (options.skipResult) {
        return Promise.resolve();
      }
      return _this._get(type, conditions, {});
    }

    return getCollection(type).then(
      function (c) {
        return cleanNulls(c, type, prepareGeoJSON(data))
          .then(
            function (data) {
              return new Promise(function (resolve, reject) {
                var updates = {};
                if (!empty(data.data)) {
                  updates.$set = data.data;
                }
                if (!empty(data.unset)) {
                  updates.$unset = data.unset;
                }
                prepareConditions(conditions);
                if (!options.bulk) {
                  c.updateOne(
                    conditions,
                    updates,
                    {upsert: options.upsert || false},
                    function (err) {
                      if (err) {
                        return reject(wrapError(err, options.upsert ? 'upsert' : 'update', type));
                      }
                      var p;
                      if (options.skipResult) {
                        p = options.upsert ? adjustAutoInc(type, updates.$set) : Promise.resolve();
                      } else {
                        p = _this._get(type, conditions, {}).then(function (r) {
                          return options.upsert ? adjustAutoInc(type, r) : Promise.resolve(r);
                        });
                      }
                      p.then(resolve).catch(reject);
                    });
                } else {
                  c.updateMany(conditions, updates,
                    function (err, result) {
                      if (err) {
                        return reject(wrapError(err, 'update', type));
                      }
                      if (options.skipResult) {
                        return resolve(result.matchedCount);
                      }
                      _this._iterator(type, {filter: conditions}).then(resolve).catch(reject);
                    });
                }
              });
            }
          );
      });
  }

  this._update = function (type, conditions, data, options) {
    return doUpdate(type, conditions, data, {bulk: options.bulk, skipResult: options.skipResult});
  };

  this._upsert = function (type, conditions, data, options) {
    return doUpdate(type, conditions, data, {upsert: true, skipResult: options.skipResult});
  };

  this._delete = function (type, conditions) {
    return getCollection(type).then(
      function (c) {
        return new Promise(function (resolve, reject) {
          prepareConditions(conditions);
          c.deleteMany(conditions,
            function (err, result) {
              if (err) {
                return reject(wrapError(err, 'delete', type));
              }
              resolve(result.deletedCount);
            });
        });
      }
    );
  };

  function addPrefix(nm, prefix, sep) {
    sep = sep || '.';
    if (nm.substr(0, nm.indexOf('.')) === prefix) {
      return nm;
    }
    return (prefix ? prefix + sep : '') + nm;
  }

  function wind(attributes) {
    var tmp, tmp2, i;
    tmp = {};
    tmp2 = {_id: false};
    for (i = 0; i < attributes.length; i++) {
      tmp[attributes[i]] = '$' + attributes[i];
      tmp2[attributes[i]] = '$_id.' + attributes[i];
    }
    return [{$group: {_id: tmp}}, {$project: tmp2}];
  }

  function clean(attributes) {
    var tmp = {};
    var i;
    for (i = 0; i < attributes.length; i++) {
      tmp[attributes[i]] = 1;
    }
    return {$project: tmp};
  }

  function joinId(join, context) {
    return (context ? context + ':' : '') + join.table + ':' + join.left + ':' +
      join.right + ':' + (join.many ? 'm' : '1');
  }

  /**
   * @param {Array} attributes
   * @param {Array} joins
   * @param {Array} result
   */
  function processJoins(attributes, joins, result, prefix) {
    if (joins.length) {
      if (!attributes || !attributes.length) {
        throw new Error('Не передан список атрибутов необходимый для выполнения объединений.');
      }
      joins.forEach(function (join) {
        var tmp;
        var left = (prefix ? prefix + '.' : '') + join.left;
        if (join.many) {
          left = '__uw_' + join.left;
          tmp = clean(attributes);
          tmp.$project[left] = '$' + (prefix ? prefix + '.' : '') + join.left;
          attributes.push(left);
          result.push(tmp);
          result.push({$unwind: {path: '$' + left, preserveNullAndEmptyArrays: true}});
        }

        tmp = {
          from: join.table,
          localField: left,
          foreignField: join.right,
          as: join.alias
        };
        result.push({$lookup: tmp});
        attributes.push(join.alias);
        if (join.passSize) {
          tmp = clean(attributes);
          tmp.$project[join.alias + '_size'] = {$size: '$' + join.alias};
          attributes.push(join.alias + '_size');
          result.push(tmp);
        }
        if (!join.onlySize || Array.isArray(join.join)) {
          result.push({$unwind: {path: '$' + join.alias, preserveNullAndEmptyArrays: true}});
        }
        /*
        if (Array.isArray(join.join)) {
          processJoins(attributes, join.join, result, join.alias);
        }
        */
      });
    }
  }

  function processJoin(attributes, joinedSources, lookups, leftPrefix, counter, joins) {
    counter = counter || {v: 0};
    return function (join) {
      leftPrefix = leftPrefix || '';
      if (!leftPrefix && attributes.indexOf(join.left) < 0) {
        attributes.push(join.left);
      }
      if (!join.alias) {
        join.alias = '__j' + counter.v;
        counter.v++;
      }
      if (leftPrefix && (join.left.indexOf('.') < 0 || join.left.substr(0, join.left.indexOf('.')) !== leftPrefix)) {
        join.left = leftPrefix + '.' + join.left;
      }
      let jid = joinId(join, leftPrefix);
      if (!lookups.hasOwnProperty(jid)) {
        lookups[jid] = join;
        if (Array.isArray(joins)) {
          joins.push(join);
        }
        joinedSources[join.alias] = join;
      }
      if (Array.isArray(join.join)) {
        join.join.forEach(processJoin(attributes, joinedSources, lookups, join.alias, counter, joins));
      }
    };
  }

  /**
   * @param {Array} attributes
   * @param {{}} find
   * @param {Object[]} joins
   * @param {{}} explicitJoins
   * @param {{v:Number}} counter
   * @returns {*}
   */
  function producePrefilter(attributes, find, joins, explicitJoins, counter, prefix) {
    counter = counter || {v: 0};
    if (Array.isArray(find)) {
      let result = [];
      for (let i = 0; i < find.length; i++) {
        let tmp = producePrefilter(attributes, find[i], joins, explicitJoins, counter, prefix);
        if (tmp !== null) {
          result.push(tmp);
        }
      }
      return result.length ? result : null;
    } else if (typeof find === 'object') {
      let result;
      let jsrc = {};
      let pj = processJoin(attributes, jsrc, explicitJoins, prefix, counter);
      for (let name in find) {
        if (find.hasOwnProperty(name)) {
          if (name === '$joinExists' || name === '$joinNotExists') {
            let jid = joinId(find[name]);
            let j;
            if (explicitJoins.hasOwnProperty(jid)) {
              j = explicitJoins[jid];
            } else {
              j = clone(find[name]);
              delete j.filter;
              j.alias = '__j' + counter.v;
              counter.v++;
            }

            find[name].alias = j.alias;
            pj(find[name]);

            for (let ja in jsrc) {
              if (jsrc.hasOwnProperty(ja)) {
                joins.push(jsrc[ja]);
              }
            }

            if (find[name].filter) {
              producePrefilter(attributes, find[name].filter, joins, explicitJoins, counter, j.alias);
            }
            result = true;
            break;
          } else {
            let jalias = prefix;
            if (name.indexOf('.') > 0) {
              jalias = name.substr(0, name.indexOf('.'));
              let i = 0;
              for (i = 0; i < joins.length; i++) {
                if (joins[i].alias === jalias) {
                  break;
                }
              }
              if (i < joins.length) {
                attributes.push(jalias);
                result = IGNORE;
                break;
              }
            }

            let tmp = producePrefilter(attributes, find[name], joins, explicitJoins, counter, jalias);
            if (name === '$or') {
              if (Array.isArray(tmp)) {
                for (let i = 0; i < tmp.length; i++) {
                  if (tmp[i] === true || tmp[i] === IGNORE) {
                    result = IGNORE;
                    break;
                  }
                }
                if (!result && tmp.length) {
                  result = tmp.length > 1 ? {$or: tmp} : tmp[0];
                }
              } else {
                result = IGNORE;
                break;
              }
            } else if (name === '$and' || name === '$nor') {
              if (Array.isArray(tmp)) {
                result = [];
                for (let i = 0; i < tmp.length; i++) {
                  if (tmp[i] !== true && tmp[i] !== IGNORE) {
                    result.push(tmp[i]);
                  }
                }
                if (name === '$and') {
                  result = result.length ? (result.length > 1 ? {$and: result} : result[0]) : IGNORE;
                } else {
                  result = result.length ? {$nor: result} : IGNORE;
                }
                break;
              } else {
                result = IGNORE;
                break;
              }
            } else {
              if (name === '$not') {
                if (Array.isArray(tmp)) {
                  let tmp2 = [];
                  for (let i = 0; i < tmp.length; i++) {
                    if (tmp[i] !== true && tmp[i] !== IGNORE) {
                      tmp2.push(tmp[i]);
                    }
                  }
                  tmp = tmp2.length ? tmp2 : IGNORE;
                }
                if (tmp === IGNORE) {
                  result = IGNORE;
                  break;
                } else {
                  result = {};
                  result.$nor = tmp;
                }
              } else {
                if (tmp === IGNORE) {
                  result = IGNORE;
                  break;
                } else if (typeof tmp === 'string' && (tmp.indexOf('.') > 0 || tmp[0] === '$')) {
                  attributes.push(tmp.indexOf('.') > 0 ? tmp.substring(0, tmp.indexOf('.')) : tmp);
                  result = IGNORE;
                  break;
                } else if (typeof tmp === 'string' && tmp[0] === '$') {
                  result = IGNORE;
                  break;
                } else {
                  result = result || {};
                  result[name] = tmp;
                }
              }
            }
          }
        }
      }
      if (result !== undefined) {
        return result;
      }
    }
    return find;
  }

  function joinPostFilter(join, explicitJoins, prefix, not) {
    var jid = joinId(join, prefix);
    var j = explicitJoins[jid];

    if (prefix) {
      j.left = addPrefix(j.left, prefix);
    }
    var f = null;
    if (join.filter || join.join) {
      f = null;
      if (join.filter) {
        f = producePostfilter(join.filter, explicitJoins, join.alias);
        if (f !== null) {
          if (not) {
            f = {$nor: f};
          }
        }
      }

      if (Array.isArray(join.join)) {
        var and = [];
        var tmp;
        for (var i = 0; i < join.join.length; i++) {
          tmp = joinPostFilter(join.join[i], explicitJoins, join.alias, false);
          if (tmp) {
            and.push(tmp);
          }
        }
        if (and.length) {
          if (f) {
            and.push(f);
          }
          f = {$and: and};
        }
      }
    } else {
      f = {};
      f[j.alias + '_size'] = 0;
      j.passSize = true;
      if (!not) {
        f[j.alias + '_size'] = {$ne: 0};
      }
    }
    return f;
  }

  /**
   * @param {{}} find
   * @param {{}} explicitJoins
   * @param {String} [prefix]
   * @returns {*}
   */
  function producePostfilter(find, explicitJoins, prefix) {
    if (Array.isArray(find)) {
      let result = [];
      for (let i = 0; i < find.length; i++) {
        let tmp = producePostfilter(find[i], explicitJoins, prefix);
        if (tmp) {
          result.push(tmp);
        }
      }
      return result.length ? result : undefined;
    } else if (typeof find === 'object' && find !== null) {
      let result;
      for (var name in find) {
        if (find.hasOwnProperty(name)) {
          if (name === '$joinExists' || name === '$joinNotExists') {
            return joinPostFilter(find[name], explicitJoins, prefix, name === '$joinNotExists');
          } else if (excludeFromPostfilter.indexOf(name) >= 0) {
            return undefined;
          } else {
            let tmp = producePostfilter(find[name], explicitJoins, prefix);
            if (tmp !== undefined) {
              result = result || {};
              if (name[0] !== '$') {
                result[prefix ? addPrefix(name, prefix) : name] = tmp;
              } else {
                result[name] = tmp;
              }
            }
          }
        }
      }
      return result;
    }
    return find;
  }

  /**
   * @param {{}} find
   * @param {{}} explicitJoins
   * @param {String} [prefix]
   * @returns {*}
   */
  function produceRedactFilter(find, explicitJoins, prefix) {
    if (Array.isArray(find)) {
      let result = [];
      for (let i = 0; i < find.length; i++) {
        let tmp = produceRedactFilter(find[i], explicitJoins, prefix);
        if (tmp) {
          result.push(tmp);
        }
      }
      return result.length ? result : null;
    } else if (typeof find === 'object' && find !== null) {
      let result = [];
      for (let name in find) {
        if (find.hasOwnProperty(name)) {
          if (name[0] === '$') {
            let tmp = produceRedactFilter(find[name], explicitJoins, prefix);
            if (tmp !== null) {
              let nm = name;
              if (name === '$nor' || name === '$or') {
                let skip = !(Array.isArray(tmp) && tmp.length);
                if (!skip) {
                  for (let i = 0; i < tmp.length; i++) {
                    if (tmp[i] === IGNORE) {
                      skip = true;
                      break;
                    }
                  }
                }
                if (skip) {
                  tmp = null;
                } else {
                  if (name === '$nor') {
                    nm = '$not';
                    if (tmp.length > 1) {
                      tmp = {$or: tmp};
                    }
                  }
                }
              } else if (name === '$and') {
                let skip = !(Array.isArray(tmp) && tmp.length);
                let tmp2 = [];
                if (!skip) {
                  for (let i = 0; i < tmp.length; i++) {
                    if (tmp[i] !== IGNORE) {
                      tmp2.push(tmp[i]);
                    }
                  }
                }
                if (skip || tmp2.length === 0) {
                  tmp = null;
                } else {
                  tmp = tmp2;
                }
              }
              if (tmp) {
                result.push({[nm]: tmp});
              }
            }
          } else {
            let nm = prefix ? addPrefix(name, prefix) : name;
            let loperand = '$' + nm;

            if (typeof find[name] === 'object' && find[name] !== null) {
              for (let oper in find[name]) {
                if (find[name].hasOwnProperty(oper)) {
                  if (excludeFromRedactfilter.indexOf(oper) < 0) {
                    if (oper === '$exists') {
                      if (find[name][oper]) {
                        result.push({$not: [{$eq: [{$type: '$' + nm}, 'missing']}]});
                      } else {
                        result.push({$eq: [{$type: '$' + nm}, 'missing']});
                      }
                    } else {
                      result.push({[oper]: [loperand, produceRedactFilter(find[name][oper], explicitJoins, prefix)]});
                    }
                  }
                }
              }
            } else {
              result.push({$eq: [loperand, find[name]]});
            }
          }
        }
      }
      if (result.length) {
        return result.length === 1 ? result[0] : {$and: result};
      }
      return null;
    }
    return find;
  }

  /**
   * @param {String} lexem
   * @param {String[]} attributes
   * @param {{}} joinedSources
   */
  function checkAttrLexem(lexem, attributes, joinedSources) {
    var tmp = lexem.indexOf('.') < 0 ? lexem : lexem.substr(0, lexem.indexOf('.'));
    if (tmp[0] === '$' && !joinedSources.hasOwnProperty(tmp)) {
      tmp = tmp.substr(1);
      if (attributes.indexOf(tmp) < 0) {
        attributes.push(tmp);
      }
    }
  }

  /**
   * @param {{}} expr
   * @param {String[]} attributes
   * @param {{}} joinedSources
   */
  function checkAttrExpr(expr, attributes, joinedSources) {
    if (typeof expr === 'string') {
      return checkAttrLexem(expr, attributes, joinedSources);
    } else if (Array.isArray(expr)) {
      for (var i = 0; i < expr.length; i++) {
        checkAttrExpr(expr[i], attributes, joinedSources);
      }
    } else if (typeof expr === 'object') {
      for (var nm in expr) {
        if (expr.hasOwnProperty(nm)) {
          if (nm[0] !== '$') {
            checkAttrLexem('$' + nm, attributes, joinedSources);
          }
          checkAttrExpr(expr[nm], attributes, joinedSources);
        }
      }
    }
  }

  /**
   * @param {String} type
   * @param {{}} options
   * @param {{}} [options.filter]
   * @param {{}} [options.fields]
   * @param {{}} [options.aggregates]
   * @param {{}} [options.joins]
   * @param {{}} [options.sort]
   * @param {String} [options.to]
   * @param {Number} [options.offset]
   * @param {Number} [options.count]
   * @param {Boolean} [options.countTotal]
   * @param {Boolean} [options.distinct]
   * @param {String[]} [options.select]
   * @param {Array} [forcedStages]
   * @param {Boolean} [onlyCount]
   * @returns {Promise}
   */
  function checkAggregation(type, options, forcedStages, onlyCount) {
    forcedStages = forcedStages || [];
    var attributes = options.attributes || [];
    var i, tmp, tmp2;
    var joinedSources = {};
    var lookups = {};
    var result = [];
    var joins = [];

    try {
      if (Array.isArray(options.joins)) {
        joins = [];
        options.joins.forEach(processJoin(attributes, joinedSources, lookups, null, null, joins));
      }

      if (options.fields) {
        for (tmp in options.fields) {
          if (options.fields.hasOwnProperty(tmp)) {
            checkAttrExpr(options.fields[tmp], attributes, joinedSources);
          }
        }
      }

      if (options.aggregates) {
        for (tmp in options.aggregates) {
          if (options.aggregates.hasOwnProperty(tmp)) {
            checkAttrExpr(options.aggregates[tmp], attributes, joinedSources);
          }
        }
      }

      var resultAttrs = attributes.slice(0);
      var prefilter, postfilter, redactFilter, jl;

      if (options.filter) {
        jl = joins.length;

        prefilter = producePrefilter(attributes, options.filter, joins, lookups);
        if (joins.length > jl || attributes.length > resultAttrs.length) {
          postfilter = producePostfilter(options.filter, lookups);
          redactFilter = produceRedactFilter(postfilter, lookups);
          postfilter = producePrefilter([], postfilter, [], []);
        }
      }

      if (prefilter && typeof prefilter === 'object' &&
        (joins.length || attributes.length > resultAttrs.length || options.to || forcedStages.length)) {
        result.push({$match: prefilter});
      }
    } catch (err) {
      return Promise.reject(wrapError(err, 'aggregate', type));
    }

    var p = null;
    if (joins.length) {
      p = getCollection(GEOFLD_COLLECTION).then(function (c) {
        return new Promise(function (resolve, reject) {
          c.find({__type: type}).limit(1).next(function (err, geoflds) {
            if (err) {
              return reject(err);
            }
            for (var fld in geoflds) {
              if (geoflds.hasOwnProperty(fld) && fld !== '__type' && fld !== '_id') {
                resultAttrs.push('__geo__' + fld + '_f');
              }
            }
            resolve();
          });
        });
      });
    } else {
      p = Promise.resolve();
    }

    return p.then(function () {
      if (joins.length) {
        processJoins(attributes, joins, result);
        if (postfilter && postfilter !== IGNORE) {
          result.push({$match: postfilter});
        }
        if (redactFilter && redactFilter !== IGNORE) {
          result.push({$redact: {$cond: [redactFilter, '$$KEEP', '$$PRUNE']}});
        }
        if (resultAttrs.length) {
          Array.prototype.push.apply(result, wind(resultAttrs));
        }
      }

      if (options.distinct && options.select.length && (result.length || options.select.length > 1)) {
        Array.prototype.push.apply(result, wind(options.select));
      }

      if (forcedStages.length) {
        Array.prototype.push.apply(result, forcedStages);
      }

      if (result.length || options.to) {
        if (options.countTotal || onlyCount) {
          tmp = {};
          tmp2 = {__total: '$__total'};
          for (i = 0; i < resultAttrs.length; i++) {
            tmp[resultAttrs[i]] = '$' + resultAttrs[i];
            tmp2[resultAttrs[i]] = '$data.' + resultAttrs[i];
          }
          result.push({$group: {_id: tmp}});
          if (onlyCount) {
            result.push({$group: {_id: null, __total: {$sum: 1}}});
          } else {
            result.push({$group: {_id: null, __total: {$sum: 1}, data: {$addToSet: '$_id'}}});
            result.push({$unwind: {path: '$data', preserveNullAndEmptyArrays: true}});
            result.push({$project: tmp2});
          }
        }

        if (!onlyCount) {
          if (options.sort) {
            result.push({$sort: options.sort});
          }
        }
      }

      if (options.to) {
        result.push({$out: options.to});
      }

      if (result.length) {
        return Promise.resolve(result);
      }

      return Promise.resolve(false);
    });
  }

  function mergeGeoJSON(data) {
    var tmp, tmp2, i;
    for (var nm in data) {
      if (data.hasOwnProperty(nm)) {
        tmp = data['__geo__' + nm + '_f'];
        if (tmp) {
          tmp2 = data[nm];
          delete data['__geo__' + nm + '_f'];
          switch (tmp.type) {
            case 'Feature': {
              tmp.geometry = tmp2;
              data[nm] = tmp;
            }
              break;
            case 'FeatureCollection': {
              for (i = 0; i < tmp2.geometries.length; i++) {
                tmp.features[i].geometry = tmp2.geometries[i];
              }
              data[nm] = tmp;
            }
              break;
          }
        }
      }
    }
    return data;
  }

  /**
   * @param {Collection} c
   * @param {{}} options
   * @param {{}} [options.filter]
   * @param {{}} [options.fields]
   * @param {{}} [options.sort]
   * @param {Number} [options.offset]
   * @param {Number} [options.count]
   * @param {Boolean} [options.countTotal]
   * @param {Boolean} [options.distinct]
   * @param {String[]} [options.select]
   * @param {Object[]} aggregate
   * @param {Function} resolve
   * @param {Function} reject
   */
  function fetch(c, options, aggregate, resolve, reject) {
    var r, flds;
    if (aggregate) {
      r = c.aggregate(aggregate, {cursor: {batchSize: options.batchSize || options.count || 1}, allowDiskUse: true});
    } else {
      if (options.distinct && options.select.length === 1) {
        return c.distinct(options.select[0], options.filter || {}, {}, function (err, data) {
          if (err) {
            return reject(err);
          }
          if (options.sort && options.sort[options.select[0]]) {
            var direction = options.sort[options.select[0]];
            data = data.sort(function compare(a, b) {
              if (a < b) {
                return -1 * direction;
              } else if (a > b) {
                return 1 * direction;
              }
              return 0;
            });
          }
          var res, stPos, endPos;
          res = [];
          stPos = options.offset || 0;
          endPos = options.count ? stPos + options.count : data.length;
          for (var i = stPos; i < endPos && i < data.length; i++) {
            var tmp = {};
            tmp[options.select[0]] = data[i];
            res.push(tmp);
          }
          resolve(res, options.countTotal ? (data.length ? data.length : 0) : null);
        });
      } else {
        flds = null;
        r = c.find(options.filter || {});
      }

      if (options.sort) {
        r = r.sort(options.sort);
      }
    }

    if (options.offset) {
      r = r.skip(options.offset);
    }

    if (options.count) {
      r = r.limit(options.count);
    }

    r.batchSize(options.batchSize || options.count || 1);

    if (options.countTotal) {
      if (aggregate) {
        r.next(function (err, d) {
          var amount = null;
          if (d && d.__total) {
            amount = d.__total;
          }
          r.rewind();
          resolve(r, amount);
        });
      } else {
        r.count(false, function (err, amount) {
          if (err) {
            r.close();
            return reject(err);
          }
          resolve(r, amount);
        });
      }
    } else {
      resolve(r);
    }
  }

  function copyColl(src, dest, cb) {
    _this.db.collection(src, {strict: true}, function (err, c2) {
      if (err) {
        return cb(err);
      }

      getCollection(dest)
        .then(
          function (c3) {
            c2.aggregate([]).toArray(function (err, docs) {
              if (err) {
                return cb(err);
              }
              if (!docs.length) {
                return cb();
              }
              c3.insertMany(docs, function (err) {
                if (err) {
                  return cb(err);
                }
                _this.db.dropCollection(src, cb);
              });
            });
          }
        )
        .catch(cb);
    });
  }

  /**
   * @param {String} type
   * @param {{}} [options]
   * @param {{}} [options.filter]
   * @param {{}} [options.fields]
   * @param {{}} [options.sort]
   * @param {Number} [options.offset]
   * @param {Number} [options.count]
   * @param {Boolean} [options.countTotal]
   * @param {Boolean} [options.distinct]
   * @param {String} [options.to]
   * @param {String} [options.append]
   * @returns {Promise}
   */
  this._fetch = function (type, options) {
    options = options || {};
    var tmpApp = null;
    var c;
    return getCollection(type).then(
      function (col) {
        c = col;
        prepareConditions(options.filter);
        if (options.append) {
          tmpApp = 'tmp_' + cuid();
          options.to = tmpApp;
        }
        return checkAggregation(type, options);
      }).then(function (aggregation) {
        return new Promise(function (resolve, reject) {
          fetch(c, options, aggregation,
            function (r, amount) {
              if (tmpApp) {
                copyColl(tmpApp, options.append, function (err) {
                  if (err) {
                    return reject(wrapError(err, 'fetch', type));
                  }
                  resolve();
                });
                return;
              }

              return new Promise(function (resolve, reject) {
                if (Array.isArray(r)) {
                  resolve(r);
                } else {
                  r.toArray(function (err, docs) {
                    r.close();
                    if (err) {
                      return reject(err);
                    }
                    resolve(docs);
                  });
                }
              }).then(function (docs) {
                docs.forEach(mergeGeoJSON);
                if (amount !== null) {
                  docs.total = amount;
                }
                return resolve(docs);
              }).catch(reject);
            },
            function (e) {reject(wrapError(e, 'fetch', type));}
          );
        });
      }
    );
  };

  function DsIterator(cursor, amount) {
    this._next = function () {
      return new Promise(function (resolve, reject) {
        cursor.hasNext(function (err, r) {
          if (err) {
            return reject(err);
          }
          if (!r) {
            return resolve(null);
          }
          cursor.next(function (err, r) {
            if (err) {
              return reject(err);
            }
            if (r) {
              return resolve(mergeGeoJSON(r));
            }
            resolve(null);
          });
        });
      });
    };

    this._count = function () {
      return amount;
    };
  }

  DsIterator.prototype = new Iterator();

  /**
   * @param {String} type
   * @param {{}} [options]
   * @param {{}} [options.filter]
   * @param {{}} [options.fields]
   * @param {{}} [options.sort]
   * @param {Number} [options.offset]
   * @param {Number} [options.count]
   * @param {Number} [options.batchSize]
   * @returns {Promise}
   */
  this._iterator = function (type, options) {
    options = options || {};
    var c;
    return getCollection(type).then(
      function (col) {
        c = col;
        prepareConditions(options.filter);
        return checkAggregation(type, options);
      }).then(function (aggregation) {
        return new Promise(function (resolve, reject) {
          try {
            options.batchSize = options.batchSize || 1;
            fetch(c, options, aggregation,
              function (r, amount) {
                resolve(new DsIterator(r, amount));
              },
              function (e) {reject(wrapError(e, 'iterate', type));}
            );
          } catch (err) {
            reject(err);
          }
        });
      }
    );
  };

  /**
   * @param {String} type
   * @param {{expressions: {}}} options
   * @param {{}} [options.filter]
   * @param {{}} [options.fields]
   * @param {{}} [options.aggregates]
   * @param {String} [options.to]
   * @returns {Promise}
   */
  this._aggregate = function (type, options) {
    options = options || {};
    var c;
    var tmpApp = null;
    return getCollection(type).then(
      function (col) {
        c = col;
        var plan = [];

        var expr = {$group: {}};

        expr.$group._id = null;
        if (options.fields && typeof options.fields === 'object') {
          for (let fld in options.fields) {
            if (options.fields.hasOwnProperty(fld)) {
              expr.$group._id = options.fields;
              break;
            }
          }
        }

        var alias, oper;
        for (alias in options.aggregates) {
          if (options.aggregates.hasOwnProperty(alias)) {
            for (oper in options.aggregates[alias]) {
              if (options.aggregates[alias].hasOwnProperty(oper)) {
                if (oper === '$count') {
                  expr.$group[alias] = {$sum: 1};
                } else if (oper === '$sum' || oper === '$avg' || oper === '$min' || oper === '$max') {
                  expr.$group[alias] = {};
                  expr.$group[alias][oper] = options.aggregates[alias][oper];
                }
              }
            }
          }
        }

        plan.push(expr);

        var attrs = {_id: false};
        if (options.fields) {
          for (alias in options.fields) {
            if (options.fields.hasOwnProperty(alias)) {
              attrs[alias] = '$_id.' + alias;
            }
          }
        }
        if (options.aggregates) {
          for (alias in options.aggregates) {
            if (options.aggregates.hasOwnProperty(alias)) {
              attrs[alias] = 1;
            }
          }
        }

        plan.push({$project: attrs});

        if (options.filter) {
          prepareConditions(options.filter);
        }

        if (options.append) {
          tmpApp = 'tmp_' + cuid();
          options.to = tmpApp;
        }

        return checkAggregation(type, options, plan);
      }).then(function (plan) {
        return new Promise(function (resolve, reject) {
          try {
            c.aggregate(plan, {allowDiskUse: true}, function (err, result) {
              if (err) {
                return reject(wrapError(err, 'aggregate', type));
              }
              if (tmpApp) {
                copyColl(tmpApp, options.append, function (err) {
                  if (err) {
                    return reject(wrapError(err, 'aggregate', type));
                  }
                  resolve();
                });
                return;
              }
              resolve(result);
            });
          } catch (err) {
            reject(err);
          }
        });
      }
    );
  };

  this._count = function (type, options) {
    var c;
    var opts = {};

    if (options.offset) {
      opts.skip = options.offset;
    }
    if (options.count) {
      opts.limit = options.count;
    }
    return getCollection(type).then(
      function (col) {
        c = col;
        prepareConditions(options.filter);
        return checkAggregation(type, options, [], true);
      }).then(function (agreg) {
        return new Promise(function (resolve, reject) {
          if (agreg) {
            c.aggregate(agreg, function (err, result) {
              if (err) {
                return reject(wrapError(err, 'count', type));
              }
              var cnt = 0;
              if (result.length) {
                cnt = result[0].__total;
              }
              resolve(cnt);
            });
          } else {
            var opts = {};
            if (options.offset) {
              opts.skip = options.offset;
            }
            if (options.count) {
              opts.limit = options.count;
            }
            c.count(options.filter || {}, opts, function (err, cnt) {
              if (err) {
                return reject(wrapError(err, 'count', type));
              }
              resolve(cnt);
            });
          }
        });
      }
    );
  };

  /**
   * @param {String} type
   * @param {{}} conditions
   * @param {{fields: {}}} options
   * @returns {Promise.<{}>}
   * @private
   */
  this._get = function (type, conditions, options) {
    let c;
    let opts = {filter: conditions, fields: options.fields || {}};
    return getCollection(type).then(
      function (col) {
        c = col;
        prepareConditions(opts.filter);
        return checkAggregation(type, opts);
      }).then(function (aggregation) {
      if (aggregation) {
        return new Promise(function (resolve, reject) {
          fetch(c, opts, aggregation,
            function (r, amount) {
              return new Promise(function (resolve, reject) {
                if (Array.isArray(r)) {
                  resolve(r);
                } else {
                  r.toArray(function (err, docs) {
                    r.close();
                    if (err) {
                      return reject(err);
                    }
                    resolve(docs);
                  });
                }
              }).then(function (docs) {
                docs.forEach(mergeGeoJSON);
                resolve(docs.length ? docs[0] : null);
              }).catch(reject);
            },
            function (e) {
              reject(wrapError(e, 'get', type));
            }
          );
        });
      } else {
        return new Promise(function (resolve, reject) {
          c.find(conditions).limit(1).next(function (err, result) {
            if (err) {
              return reject(wrapError(err, 'get', type));
            }
            resolve(mergeGeoJSON(result));
          });
        });
      }
    });
  };

  /**
   * @param {String} type
   * @param {{}} properties
   * @param {{unique: Boolean}} [options]
   * @returns {Promise}
   */
  this._ensureIndex = function (type, properties, options) {
    return getCollection(type).then(
      function (c) {
        return new Promise(function (resolve) {
          c.createIndex(properties, options || {}, function () {
            resolve(c);
          });
        });
      });
  };

  /**
   * @param {String} type
   * @param {{}} properties
   * @returns {Promise}
   */
  this._ensureAutoincrement = function (type, properties) {
    var data = {};
    var steps = {};
    var act = false;
    if (properties) {
      for (var nm in properties) {
        if (properties.hasOwnProperty(nm)) {
          data[nm] = 0;
          steps[nm] = properties[nm];
          act = true;
        }
      }

      if (act) {
        return new Promise(function (resolve, reject) {
          getCollection(AUTOINC_COLLECTION).then(
            function (c) {
              c.findOne({__type: type}, function (err, r) {
                if (err) {
                  return reject(err);
                }

                if (r && r.counters) {
                  for (var nm in r.counters) {
                    if (r.counters.hasOwnProperty(nm) && data.hasOwnProperty(nm)) {
                      data[nm] = r.counters[nm];
                    }
                  }
                }

                c.updateOne(
                  {__type: type},
                  {$set: {counters: data, steps: steps}},
                  {upsert: true},
                  function (err) {
                    if (err) {
                      return reject(err);
                    }
                    resolve();
                  }
                );
              });
            }
          ).catch(e => reject(e));
        });
      }
    }
    return Promise.resolve();
  };
}

// Util.inherits(MongoDs, DataSource); //jscs:ignore requireSpaceAfterLineComment

MongoDs.prototype = new DataSource();

module.exports = MongoDs;
