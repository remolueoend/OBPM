import * as q from 'q';
import httpErr from './routing/HttpError';
import IModel from './models/IModel';
import ModelBinder from './routing/ModelBinder';
import ModelState from './routing/ModelState';
import toQ from './helpers/toq';

let arango = require('arangojs'),
    aqlQuery = require('arangojs').aqlQuery;
/**
 * global collection of cached connections per database name.
 *
 * @type {Object}
 */
let _connections = {};

/**
 * Object containing names of default collections per database names
 * wich should be created if they do not exist yet.
 *
 * @type {Object}
 */
let _defElements = {
    default: {
        cols: ['Action', 'Document', 'DocumentType', 'Execution', 'Record'],
        edges: ['hasDocument', 'hasModel'],
        graphs: [{
            name: 'documentTypes',
            edgeDefinitions: [{
                collection: 'hasModel',
                from: ['DocumentType'],
                to: ['DocumentType']
            }]
        }, {
            name: 'documents',
            edgeDefinitions: [{
                collection: 'hasDocument',
                from: ['Document'],
                to: ['Document']
            }]
        }],
        docs: [],
        aql: [{
            name: 'obpm::getDocumentArray',
            code: function (action) {
                var result=[];
                for (var dName in action.documents) {
                    if (action.documents.hasOwnProperty(dName)) {
                        result.push(action.documents[dName]);
                    }
                }
                return result;
            }
        }]
    },
    obpm_users: {
        cols: ['User', 'Client'],
        edges: [],
        graphs: [],
        docs: [{
            col: 'User',
            data: {
                "userName": "admin",
                "firstName": "admin",
                "lastName": "admin",
                "email": "admin@obpm",
                "password": "pbkdf2$10000$1050c22e5a105bf4cdb3cb11ce81c05824169f39f25def2d723b2d672124082a7b1553473141007cd97540604ad20301a7beb26dc048f76c0672b5b458c2af52$1ab1682e645156807386af57550f31aaea29b693019060f7d8b57b323f67d383702d3d9480417cc5f0fc901d8d58c283400dd7ac6dd2c749bc5001969e99a0b3",
                "roles": ["admin"]
            }
        }, {
            col: 'User',
            data: {
                "firstName": "test",
                "userName": "test-modeler",
                "lastName": "modeler",
                "email": "test-modeler@obpm",
                "password": "pbkdf2$10000$d9907b89f5ad4b655d1430cff18e4ffc45d43e684c5ab2f589e49f563cc016aedb81ceaedcccb296162cd564d0a3b80eb47cfc8e89f1eb69c767d5948c5ff1e5$2af0d8e40c68b8b007db833155698beae98481aa93fd2e36793af37eb549576f62aaabe55200de170a56b7fac98193a361397be6fc860296330ad6b42b6ffc8a",
                "roles": ["modeler"]
            }
        }, {
            col: 'User',
            data: {
                "firstName": "test",
                "userName": "test-teacher",
                "lastName": "teacher",
                "email": "test-teacher@obpm",
                "password": "pbkdf2$10000$98126e29b61c2ffc224eda9ee23075d0d25db25b98d4b803787be3bec4389850e3d20f9dafc9949b3b193f86114d2ecf8f26631b81bb0d957e325692bd3dac88$15f7d45c8514826ccd6ebd68a7f985ddc2d6739e4a38e580b709a5738325cea339a4832d7d2832156a786e645a3d390f28158b3180c4569751917de05cb1f13c",
                "roles": ["teacher"]
            }
        }, {
            col: 'User',
            data: {
                "firstName": "test",
                "userName": "test-student",
                "lastName": "student",
                "email": "test-student@obpm",
                "password": "pbkdf2$10000$7bc671c3ae1f4249bdbde39fe592e6bd601f4692b11996b9620d1e60315d8ca57b899f031f76238ad77c0ed83b4c5bb36faaf85aef6829dd9a691a8465867da9$054220f88ae444b4c8fe10fc2afc2b94340d8efa88ccbdcbb4736183dfd9809bdb5ca3c12ef32c60a589e3a43f0d12fbcdadee9c3b9c924023b0906d6568fcc1",
                "roles": ["student"]
            }
        }],
        aql: []
    }
};

/**
 * Provides basic functionality to access the database.
 */
export class Database{

    protected conn: any;

    /**
     * Creates a new database context.
     *
     * @constructor
     * @param {string} dbName The database name to connect to.
     */
    constructor(protected dbName: string){
    }

    /**
     * Initializes the database context and creates a new database if it does not exist.
     * This method has to be called before using this database interface.
     * @returns {any}
     */
    public init(): Promise<any>{
        let dbInst = arango();

        return dbInst.listDatabases().then((names: Array<string>) => {
            if (names.indexOf(this.dbName) >= 0) {
                return true;
            } else {
                return dbInst.createDatabase(this.dbName);
            }
        }).then((existed) => {
            this.conn = new arango.Database({databaseName : this.dbName});
            this.conn.useDatabase(this.dbName);

            return existed === true ? this : this.prepareDatabase();
        });
    }

    /**
     * Creates all default objects, such as collections, edge collections, graphs, etc.
     *
     * @method prepareDatabase
     *
     * @returns {q.Promise<any>}
     */
    private prepareDatabase(): q.Promise<any>{
        let elems = _defElements[this.dbName] || _defElements.default;
        let ps = [];
        // collectins:
        ps.push(elems.cols.map(c => {
            return toQ(this.conn.collection(c).create());
        }));
        // edge collections:
        ps.push(elems.edges.map(c => {
            return toQ(this.conn.edgeCollection(c).create());
        }));

        return q.all(ps)
        .then(() => {
            ps = [];
            // graphs:
            ps.push(elems.graphs.map(g => {
                return toQ(this.conn.graph(g.name).create({
                    edgeDefinitions: g.edgeDefinitions
                }));
            }));
            // documents:
            ps.push(elems.docs.map(d => {
                return toQ(this.conn.collection(d.col).save(d.data));
            }));
            // AQL functions:
            ps.push(elems.aql.map(a => {
                return toQ(this.conn.createFunction(a.name, a.code.toString()));
            }));

            return q.all(ps);

        })
        .then(() => this);
    }

    /**
     * Executes the specified query using aqlQuery.
     * @param {string} query The query to execute.
     * @param bindVars
     * @param opts
     * @returns {any}
     */
    public q(query, bindVars?, opts?): q.Promise<any>{
        return toQ(this.conn.query(query, bindVars, opts));
    }

    public collection(name: string): any{
        return this.conn.collection(name);
    }

    public edgeCollection(name: string): any{
        return this.conn.edgeCollection(name);
    }

    public graph(name: string): any{
        return this.conn.graph(name);
    }

    public single(query, throwIfNull?: boolean): q.Promise<any>{
        return this.q(query).then(result => {
            if(throwIfNull === true && !result.hasNext()) {
                throw new Error('Could not find a single resource.');
            }
            return toQ(result.next());
        });
    }

    public all(query: string): q.Promise<any> {
        return this.q(query).then(result => {
            return toQ(result.all());
        });
    }

    /**
     * Returns an instance of a database model:
     * 1. dynamically require model class
     * 2. retrieve model data from database
     * 3. use ModelBinder to bind data to model instance
     * @param {string} type Model type.
     * @param {string} id Model instance id.
     */
    public getModel(type: string, key: any): q.Promise<any>{
        return this.single(`
            for model in ${type}
            filter model._key == "${key}"
            return model
        `);
    }

    public getModelById(id: string): q.Promise<any> {
        let ids = id.split('/');
        return this.getModel(ids[0], ids[1]);
    }

    public drop(): q.Promise<any> {
        return toQ<any>(arango().dropDatabase(this.dbName)
        .then(() => {
            delete _connections[this.dbName];
            return 'process database deleted successfully.';
        }));
    }
}

/**
 * Returns an existing or new database instance for the given DB name.
 *
 * @method getDatabase
 *
 * @param {string} dbName The name of the database.
 *
 * @returns {q.Promise<Database>} Promise resolving the database instance.
 */
export default function getDatabase(dbName: string): q.Promise<any>{
    if (_connections[dbName]) {
        return q.fcall(() => { return _connections[dbName]; });
    } else {
        _connections[dbName] = new Database(dbName);
        return toQ(_connections[dbName].init());
    }
}
