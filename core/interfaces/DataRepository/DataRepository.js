/**
 * Created by Vasiliy Ermilov (email: inkz@xakep.ru, telegram: @inkz1) on 28.04.16.
 */
'use strict';
/**
 *
 * @constructor
 */
function DataRepository() {

  /**
   * @param {String} className
   * @param {{}} data
   * @param {String} [version]
   * @param {{}} [options]
   * @returns {Item}
   */
  this.wrap = function (className, data, version, options) {
    return this._wrap(className, data, version, options || {});
  };

  /**
   *
   * @param {Object[]} validators
   * @returns {Promise}
   */
  this.setValidators = function (validators) {
    return this._setValidators(validators);
  };

  /**
   * @param {String | Item} obj
   * @param {{filter: Object}} [options]
   * @returns {Promise}
   */
  this.getCount  = function (obj, options) {
    try {
      return this._getCount(obj, options || {});
    } catch (err) {
      return Promise.reject(err);
    }
  };

  /**
   * @param {String | Item} obj
   * @param {{}} [options]
   * @param {{}} [options.filter]
   * @param {Number} [options.offset]
   * @param {Number} [options.count]
   * @param {{}} [options.sort]
   * @param {Boolean} [options.countTotal]
   * @param {Number} [options.nestingDepth]
   * @param {{}} [options.env]
   * @param {User} [options.user]
   * @returns {Promise}
   */
  this.getList = function (obj, options) {
    try {
      return this._getList(obj, options || {});
    } catch (err) {
      return Promise.reject(err);
    }
  };

  /**
   * @param {String | Item} obj
   * @param {{}} [options]
   * @param {{}} [options.filter]
   * @param {Number} [options.offset]
   * @param {Number} [options.count]
   * @param {{}} [options.sort]
   * @param {Boolean} [options.countTotal]
   * @param {Number} [options.nestingDepth]
   * @param {{}} [options.env]
   * @param {User} [options.user]
   * @returns {Promise}
   */
  this.getIterator = function (obj, options) {
    try {
      return this._getIterator(obj, options || {});
    } catch (err) {
      return Promise.reject(err);
    }
  };

  /**
   * @param {String} className
   * @param {{}} [options]
   * @param {User} [options.user]
   * @param {{}} [options.expressions]
   * @param {{}} [options.filter]
   * @param {{}} [options.groupBy]
   * @returns {Promise}
   */
  this.aggregate = function (className, options) {
    try {
      return this._aggregate(className, options || {});
    } catch (err) {
      return Promise.reject(err);
    }
  };

  /**
   * @param {String} className
   * @param {{}} [options]
   * @param {User} [options.user]
   * @param {{}} [options.filter]
   * @param {String[]} [options.attributes]
   * @param {Boolean} [options.distinct]
   * @returns {Promise}
   */
  this.rawData = function (className, options) {
    try {
      return this._rawData(className, options || {});
    } catch (err) {
      return Promise.reject(err);
    }
  };

  /**
   * @param {String | Item} obj
   * @param {String} [id]
   * @param {{}} [options]
   * @param {{}} [options.filter]
   * @param {Number} [options.nestingDepth]
   * @param {User} [options.user]
   * @returns {Promise}
   */
  this.getItem = function (obj, id, options) {
    try {
      return this._getItem(obj, id, options || {});
    } catch (err) {
      return Promise.reject(err);
    }
  };

  /**
   * @param {String} className
   * @param {{}} data
   * @param {String} [version]
   * @param {ChangeLogger} [changeLogger]
   * @param {{}} [options]
   * @param {Number} [options.nestingDepth]
   * @param {Boolean} [options.skipResult]
   * @param {Boolean} [options.adjustAutoInc]
   * @param {User} [options.user]
   * @returns {Promise}
   */
  this.createItem = function (className, data, version, changeLogger, options) {
    try {
      return this._createItem(className, data, version, changeLogger, options || {});
    } catch (err) {
      return Promise.reject(err);
    }
  };

  /**
   * @param {String} className
   * @param {String} id
   * @param {{}} data
   * @param {ChangeLogger} [changeLogger]
   * @param {{}} [options]
   * @param {Number} [options.nestingDepth]
   * @param {Boolean} [options.skipResult]
   * @param {Boolean} [options.adjustAutoInc]
   * @param {User} [options.user]
   * @returns {Promise}
   */
  this.editItem = function (className, id, data, changeLogger, options) {
    try {
      return this._editItem(className, id, data, changeLogger, options || {});
    } catch (err) {
      return Promise.reject(err);
    }
  };

  /**
   * @param {String} className
   * @param {String} id
   * @param {{}} data
   * @param {String} [version]
   * @param {ChangeLogger} [changeLogger]
   * @param {{}} [options]
   * @param {Number} [options.nestingDepth]
   * @param {Boolean} [options.autoAssign]
   * @param {Boolean} [options.skipResult]
   * @param {Boolean} [options.adjustAutoInc]
   * @param {User} [options.user]
   * @returns {Promise}
   */
  this.saveItem = function (className, id, data, version, changeLogger, options) {
    try {
      return this._saveItem(className, id, data, version, changeLogger, options || {});
    } catch (err) {
      return Promise.reject(err);
    }
  };

  /**
   * @param {String} className
   * @param {String} id
   * @param {ChangeLogger} [changeLogger]
   * @param {{}} [options]
   * @param {User} [options.user]
   * @returns {Promise}
   */
  this.deleteItem = function (className, id, changeLogger, options) {
    try {
      return this._deleteItem(className, id, changeLogger, options || {});
    } catch (err) {
      return Promise.reject(err);
    }
  };

  /**
   * @param {Item} master
   * @param {String} collection
   * @param {Item[]} details
   * @param {ChangeLogger} [changeLogger]
   * @param {{}} [options]
   * @param {User} [options.user]
   * @returns {Promise}
   */
  this.put = function (master, collection, details, changeLogger, options) {
    try {
      return this._put(master, collection, details, changeLogger, options || {});
    } catch (err) {
      return Promise.reject(err);
    }
  };

  /**
   * @param {Item} master
   * @param {String} collection
   * @param {Item[]} details
   * @param {ChangeLogger} [changeLogger]
   * @param {{}} [options]
   * @param {User} [options.user]
   * @returns {Promise}
   */
  this.eject = function (master, collection, details, changeLogger, options) {
    try {
      return this._eject(master, collection, details, changeLogger, options || {});
    } catch (err) {
      return Promise.reject(err);
    }
  };

  /**
   * @param {Item} master
   * @param {String} collection
   * @param {{}} [options]
   * @param {{}} [options.filter]
   * @param {Number} [options.offset]
   * @param {Number} [options.count]
   * @param {{}} [options.sort]
   * @param {Boolean} [options.countTotal]
   * @param {Number} [options.nestingDepth]
   * @param {User} [options.user]
   * @returns {Promise}
   */
  this.getAssociationsList = function (master, collection, options) {
    try {
      return this._getAssociationsList(master, collection, options || {});
    } catch (err) {
      return Promise.reject(err);
    }
  };

  /**
   * @param {Item} master
   * @param {String} collection
   * @param {{}} [options]
   * @param {{}} [options.filter]
   * @param {Number} [options.offset]
   * @param {Number} [options.count]
   * @param {{}} [options.sort]
   * @param {Boolean} [options.countTotal]
   * @param {Number} [options.nestingDepth]
   * @param {User} [options.user]
   * @returns {Promise}
   */
  this.getAssociationsCount = function (master, collection, options) {
    try {
      return this._getAssociationsCount(master, collection, options || {});
    } catch (err) {
      return Promise.reject(err);
    }
  };

  /**
   * @param {String} classname
   * @param {{}} data
   * @param {{}} [options]
   * @param {Object} [options.filter]
   * @param {Number} [options.nestingDepth]
   * @param {String[][]} [options.forceEnrichment]
   * @param {User} [options.user]
   * @returns {Promise}
   */
  this.bulkEdit = function (classname, data, options) {
    try {
      return this._bulkEdit(classname, data, options || {});
    } catch (err) {
      return Promise.reject(err);
    }
  };

  /**
   * @param {String} classname
   * @param {{}} [options]
   * @param {Object} [options.filter]
   * @param {User} [options.user]
   * @returns {Promise}
   */
  this.bulkDelete = function (classname, options) {
    try {
      return this._bulkDelete(classname, options || {});
    } catch (err) {
      return Promise.reject(err);
    }
  };

  /**
   * @param {Item} item
   * @param {{}} [options]
   * @returns {Promise}
   */
  this.recache = function (item, options) {
    try {
      return this._recache(item, options || {});
    } catch (err) {
      return Promise.reject(err);
    }
  };
}

module.exports = DataRepository;
