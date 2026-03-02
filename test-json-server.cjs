const fs = require('fs');
const _ = require('lodash');
const lodashId = require('lodash-id');
_.mixin(lodashId);
const pluralize = require('pluralize');

const db = JSON.parse(fs.readFileSync('./data/db.json'));
const opts = { foreignKeySuffix: 'Id' };

const removable = [];
_.each(db, (coll, collName) => {
  _.each(coll, doc => {
    _.each(doc, (value, key) => {
      if (new RegExp(`${opts.foreignKeySuffix}$`).test(key)) {
        const refName = pluralize.plural(key.replace(new RegExp(`${opts.foreignKeySuffix}$`), ''));
        if (db[refName]) {
          try {
            const ref = _.getById(db[refName], value);
            if (_.isUndefined(ref)) {
              removable.push({ name: collName, id: doc.id });
            }
          } catch (e) {
            console.error('CRASH ON:', { collName, docId: doc.id, key, value, refName });
            console.error(e.stack);
          }
        }
      }
    });
  });
});
console.log('Removable:', removable);
