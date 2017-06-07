/**
 * Created by Vasiliy Ermilov (email: inkz@xakep.ru, telegram: @inkz1) on 26.04.16.
 */
'use strict';

var DbSync = require('core/interfaces/DbSync');

const AUTOINC_COLL = '__autoinc';
const GEOFLD_COLL = '__geofields';
const PropertyTypes = require('core/PropertyTypes');

/* jshint maxstatements: 30, maxcomplexity: 30 */
function MongoDbSync(options) {

  var _this = this;

  /**
   * @type {String}
   */
  this.userTypeTableName = options.UsertypeTableName || 'ion_usertype';

  /**
   * @type {String}
   */
  this.metaTableName = options.MetaTableName || 'ion_meta';

  /**
   * @type {String}
   */
  this.viewTableName = options.ViewTableName || 'ion_view';

  /**
   * @type {String}
   */
  this.navTableName = options.NavTableName || 'ion_nav';

  /**
   * @type {String}
   */
  this.workflowTableName = options.WorkflowTableName || 'ion_workflow';

  var log = options.log || console;

  /**
   * @returns {Db}
   */
  function db() {return options.dataSource.connection(); }

  function sysIndexer(tableType) {
    return function (collection) {
      switch (tableType) {
        case 'meta': {
          return new Promise(function (resolve, reject) {
            collection.createIndex({
                namespace: 1,
                name: 1,
                version: 1
              },
              {
                unique: true
              }, function (err) {
                if (err) {
                  return reject(err);
                }
                resolve(collection);
              });
          });
        }break;
        case 'view': {
          return new Promise(function (resolve, reject) {
            collection.createIndex({
                namespace: 1,
                type: 1,
                path: 1,
                className: 1,
                version: 1
              },
              {
                unique: true
              }, function (err) {
                if (err) {
                  return reject(err);
                }
                resolve(collection);
              });
          });
        }break;
        case 'nav': {
          return new Promise(function (resolve, reject) {
            collection.createIndex({
                namespace: 1,
                itemType: 1,
                name: 1,
                code: 1
              },
              {
                unique: true
              }, function (err) {
                if (err) {
                  return reject(err);
                }
                resolve(collection);
              });
          });
        }break;
        case 'user_type': {
          return new Promise(function (resolve, reject) {
            resolve(collection);
          });
        }break;
      }
      throw new Error('Unsupported table type specified!');
    };
  }

  function getMetaTable(type) {
    return new Promise(function (resolve, reject) {
      var tn = '';
      switch (type) {
        case 'meta':
          tn = _this.metaTableName;
          break;
        case 'view':
          tn = _this.viewTableName;
          break;
        case 'nav':
          tn = _this.navTableName;
          break;
        case 'user_type':
          tn = _this.userTypeTableName;
          break;
        case 'workflow':
          tn = _this.workflowTableName;
          break;
      }

      if (!tn) {
        return reject('Unsupported meta type specified!');
      }
      db().collection(tn, {strict: true}, function (err, collection) {
        if (collection) {
          return resolve(collection);
        }
        db().createCollection(tn).then(sysIndexer(type)).then(resolve).catch(reject);
      });
    });
  }

  function getSysColl(name) {
    return new Promise(function (resolve, reject) {
      db().collection(name, {strict: true}, function (err, collection) {
        if (collection) {
          return resolve(collection);
        }
        db().createCollection(name).then(
          function (collection) {
            return new Promise(function (resolve, reject) {
              collection.createIndex({__type: 1}, {unique: true}, function (err) {
                return err ? reject(err) : resolve(collection);
              });
            });
          }
        ).then(resolve).catch(reject);
      });
    });
  }

  /**
   * @param {{}} cm
   * @returns {Promise}
   */
  function findClassRoot(cm, metaCollection, done) {
    if (!cm.ancestor) {
      return done(null, cm);
    }
    var query = {name: cm.ancestor};
    if (cm.namespace) {
      query.namespace = cm.namespace;
    } else {
      query.$or = [{namespace: {$exists: false}}, {namespace: null}];
    }
    metaCollection.find(query).limit(1).next(function (err, anc) {
      if (err) {
        return done(err);
      }
      if (anc) {
        findClassRoot(anc, metaCollection, done);
      } else {
        done(new Error('Класс ' + cm.ancestor + ' не найден!'));
      }
    });
  }

  this._init = function () {
    return getMetaTable('meta').
        then(function () {return getMetaTable('view');}).
        then(function () {return getMetaTable('nav');}).
        then(function () {return getMetaTable('user_type');}).
        then(function () {return getSysColl(AUTOINC_COLL);}).
        then(function () {return getSysColl(GEOFLD_COLL);});
  };

  /**
   * @param {{}} cm
   * @returns {Promise}
   * @private
   */
  function createCollection(cm) {
    return new Promise(function (resolve, reject) {
      var cn = (cm.namespace ? cm.namespace + '_' : '') + cm.name;
      db().collection(
        cn,
        {strict: true},
        function (err, collection) {
          if (!collection) {
            db().createCollection(cn).then(resolve).catch(reject);
          } else {
            if (err) {
              return reject(err);
            }
            resolve(collection);
          }
        }
      );
    });
  }

  /**
   * @param {{}} cm
   * @private
   */
  function addIndexes(cm, rcm) {
    /**
     * @param {Collection} collection
     */
    return function (collection) {
      function createIndexPromise(props, unique, nullable, type) {
        return function () {
          var opts = {};
          if (unique) {
            opts.unique = true;
            if (nullable) {
              opts.sparse = true;
            }
          }

          var indexDef = {};
          if (typeof props === 'string') {
            indexDef = props;
          } else if (Array.isArray(props)) {
            for (let i = 0; i < props.length; i++) {
              if (props[i]) {
                indexDef[props[i]] = type === PropertyTypes.GEO ? '2dsphere' : 1;
              }
            }
          }

          if (Object.getOwnPropertyNames(indexDef).length === 0) {
            return Promise.resolve();
          }

          return new Promise(function (resolve) {
            collection.createIndex(indexDef, opts, function (err, iname) {
              resolve(iname);
            });
          });
        };
      }

      function createFullText(props) {
        return function () {
          var indexDef = {};
          for (let i = 0; i < props.length; i++) {
            indexDef[props[i]] = 'text';
          }
          var opts = {};
          return new Promise(function (resolve) {
            collection.createIndex(indexDef, opts, function (err, iname) {
              resolve(iname);
            });
          });
        };
      }

      function registerGeoField(property) {
        return function () {
          return getSysColl(GEOFLD_COLL)
            .then(function (coll) {
              return new Promise(function (resolve, reject) {
                var cn = (rcm.namespace ? rcm.namespace + '_' : '') + rcm.name;
                var d = {};
                d[property.name] = true;
                coll.updateOne(
                  {
                    __type: cn
                  },
                  {$set: d},
                  {upsert: true},
                  function (err) {
                    return err ? reject(err) : resolve();
                  }
                );
              });
            });
        };
      }

      var promise = createIndexPromise(cm.key, true)();
      promise = promise.then(createIndexPromise('_class', false));

      var fullText = [];
      var props = {};
      for (let i = 0; i < cm.properties.length; i++) {
        props[cm.properties[i].name] = cm.properties[i];
        if (
          cm.properties[i].type === PropertyTypes.REFERENCE ||
          cm.properties[i].indexed ||
          cm.properties[i].unique
        ) {
          promise = promise.then(
            createIndexPromise(
              cm.properties[i].name,
              cm.properties[i].unique,
              cm.properties[i].nullable,
              cm.properties[i].type
            )
          );
        }

        if (
          cm.properties[i].indexSearch &&
          (
            cm.properties[i].type === PropertyTypes.STRING ||
            cm.properties[i].type === PropertyTypes.URL ||
            cm.properties[i].type === PropertyTypes.HTML ||
            cm.properties[i].type === PropertyTypes.TEXT
          )
        ) {
          fullText.push(cm.properties[i].name);
        }

        if (cm.properties[i].type === PropertyTypes.GEO) {
          promise = promise.then(registerGeoField(cm.properties[i]));
        }
      }

      if (cm.compositeIndexes) {
        for (let i = 0; i < cm.compositeIndexes.length; i++) {
          let tmp = false;
          for (let j = 0; j < cm.compositeIndexes[i].properties.length; j++) {
            if (props[cm.compositeIndexes[i].properties[j]].nullable) {
              tmp = true;
              break;
            }
          }
          promise = promise.then(
            createIndexPromise(cm.compositeIndexes[i].properties, cm.compositeIndexes[i].unique, tmp)
          );
        }
      }

      if (fullText.length) {
        promise = promise.then(createFullText(fullText));
      }

      return promise;
    };
  }

  function addAutoInc(cm) {
    /**
     * @param {Collection} collection
     */
    return function (collection) {
      var cn = (cm.namespace ? cm.namespace + '_' : '') + cm.name;
      var inc = {};
      for (var i = 0; i < cm.properties.length; i++) {
        if (cm.properties[i].type === 6 && cm.properties[i].autoassigned === true) {
          inc[cm.properties[i].name] = 0;
        }
      }

      if (Object.keys(inc).length > 0) {
        return getSysColl(AUTOINC_COLL).then(function (autoinc) {
          return new Promise(function (resolve, reject) {
            autoinc.find({__type: cn}).limit(1).next(function (err, c) {
              if (err) {
                return reject(err);
              }

              if (c && c.counters) {
                for (var nm in c.counters) {
                  if (c.counters.hasOwnProperty(nm) && inc.hasOwnProperty(nm)) {
                    inc[nm] = c.counters[nm];
                  }
                }
              }

              autoinc.updateOne({__type: cn}, {$set: {counters: inc}}, {upsert: true}, function (err) {
                if (err) {
                  return reject(err);
                }
                resolve(collection);
              });
            });
          });
        });
      }
      return Promise.resolve(collection);
    };
  }

  /**
   * @param {{}} classMeta
   * @returns {Promise}
   * @private
   */
  this._defineClass = function (classMeta) {
    return getMetaTable('meta')
      .then(function (metaCollection) {
        return new Promise(function (resolve, reject) {
          findClassRoot(classMeta, metaCollection, function (err, cm) {
            if (err) {
              return reject(err);
            }
            createCollection(cm).
            then(addAutoInc(classMeta)).
            then(addIndexes(classMeta, cm)).
            then(function () {
              delete classMeta._id;
              log.log('Регистрируем класс ' + classMeta.name);
              metaCollection.updateOne(
                {
                  name: classMeta.name,
                  version: classMeta.version,
                  namespace: classMeta.namespace
                },
                classMeta,
                {upsert: true},
                function (err, result) {
                  if (err) {
                    return reject(err);
                  }
                  log.log(`Класс ${classMeta.name}@${classMeta.namespace} зарегистрирован.`);
                  resolve(result);
                }
              );
            }).catch(reject);
          });
        });
      });
  };

  this._undefineClass = function (className, version) {
    return new Promise(function (resolve, reject) {
      getMetaTable('meta').then(function (collection) {
        let parts = className.split('@');
        let query = {name: parts[0]};
        if (version) {
          query.version = version;
        }
        if (parts[1]) {
          query.namespace = parts[1];
        } else {
          query.$or = [{namespace: {$exists: false}}, {namespace: false}];
        }
        collection.remove(query, function (err, cm) {
          if (err) {
            return reject(err);
          }
          resolve(cm);
        });
      }).catch(reject);
    });
  };

  this._defineView = function (viewMeta, className, type, path) {
    return new Promise(function (resolve, reject) {
      viewMeta.type = type;
      viewMeta.className = className;
      viewMeta.path = path || '';
      delete viewMeta._id;

      getMetaTable('view').then(function (collection) {
        collection.update(
          {
            type: viewMeta.type,
            className: viewMeta.className,
            path: viewMeta.path,
            version: viewMeta.version
          },
          viewMeta,
          {upsert: true},
          function (err, vm) {
            if (err) {
              return reject(err);
            }
            log.log('Создано представление ' + type + ' для класса ' + className);
            resolve(vm);
          });
      }).catch(reject);
    });
  };

  this._undefineView = function (className, type, path, version) {
    return new Promise(function (resolve, reject) {
      getMetaTable('view').then(function (collection) {
        var query = {
          className: className,
          type: type,
          path: path
        };
        if (version) {
          query.version = version;
        }

        collection.remove(query, function (err,vm) {
          if (err) {
            return reject(err);
          }
          resolve(vm);
        });
      }).catch(reject);
    });
  };

  this._defineNavSection = function (navSection) {
    return new Promise(function (resolve, reject) {
      getMetaTable('nav').then(function (collection) {
        navSection.itemType = 'section';
        delete navSection._id;

        collection.updateOne(
          {
            name: navSection.name,
            itemType: navSection.itemType,
            namespace: navSection.namespace
          },
          navSection,
          {upsert: true},
          function (err, ns) {
            if (err) {
              return reject(err);
            }
            resolve(ns);
          });
      }).catch(reject);
    });
  };

  this._undefineNavSection = function (sectionName, namespace) {
    return new Promise(function (resolve, reject) {
      getMetaTable('nav').then(function (collection) {
        var query = {name: sectionName, itemType: 'section'};
        if (namespace) {
          query.namespace = namespace;
        } else {
          query.$or = [{namespace: {$exists: false}}, {namespace: false}];
        }

        collection.remove(query, function (err,nsm) {
          if (err) {
            return reject(err);
          }
          resolve(nsm);
        });
      }).catch(reject);
    });
  };

  this._defineNavNode = function (navNode, navSectionName) {
    return new Promise(function (resolve, reject) {
      getMetaTable('nav').then(function (collection) {
        navNode.itemType = 'node';
        navNode.section = navSectionName;
        delete navNode._id;

        collection.updateOne(
          {
            code: navNode.code,
            itemType: navNode.itemType,
            namespace: navNode.namespace
          },
          navNode,
          {upsert: true},
          function (err, ns) {
            if (err) {
              return reject(err);
            }
            log.log('Создан узел навигации ' + navNode.code);
            resolve(ns);
          });
      }).catch(reject);
    });
  };

  this._undefineNavNode = function (navNodeName, namespace) {
    return new Promise(function (resolve, reject) {
      getMetaTable('nav').then(function (collection) {
        var query = {code: navNodeName, itemType: 'node'};
        if (namespace) {
          query.namespace = namespace;
        } else {
          query.$or = [{namespace: {$exists: false}}, {namespace: false}];
        }
        collection.remove(query, function (err,nnm) {
          if (err) {
            return reject(err);
          }
          resolve(nnm);
        });
      }).catch(reject);
    });
  };

  /**
   * @param {{wfClass: String, name: String, version: String}} wfMeta
   * @returns {Promise}
   * @private
   */
  this._defineWorkflow = function (wfMeta) {
    return new Promise(function (resolve, reject) {
      delete wfMeta._id;

      getMetaTable('workflow').then(function (collection) {
        collection.update(
          {
            wfClass: wfMeta.wfClass,
            name: wfMeta.name,
            version: wfMeta.version
          },
          wfMeta,
          {upsert: true},
          function (err, wf) {
            if (err) {
              return reject(err);
            }
            log.log('Создан бизнес-процесс ' + wfMeta.name + ' для класса ' + wfMeta.wfClass);
            resolve(wf);
          });
      }).catch(reject);
    });
  };

  /**
   * @param {String} className
   * @param {String} name
   * @param {String} [version]
   * @returns {Promise}
   * @private
   */
  this._undefineWorkflow = function (className, name, version) {
    return new Promise(function (resolve, reject) {
      getMetaTable('view').then(function (collection) {
        var query = {
          wfClass: className,
          name: name
        };
        if (version) {
          query.version = version;
        }

        collection.remove(query, function (err, wf) {
          if (err) {
            return reject(err);
          }
          resolve(wf);
        });
      }).catch(reject);
    });
  };

  this._defineUserType = function (userType) {
    return new Promise(function (resolve, reject) {
      getMetaTable('user_type').then(function (collection) {
        collection.updateOne(
          {
            name: userType.name
          },
          userType,
          {upsert: true},
          function (err, ns) {
            if (err) {
              return reject(err);
            }
            resolve(ns);
          }
        );
      }).catch(reject);
    });
  };
}

MongoDbSync.prototype = new DbSync();
module.exports = MongoDbSync;
