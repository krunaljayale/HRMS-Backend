import { Injectable, NotFoundException } from '@nestjs/common';
import { Employee, EmployeeDocument } from './employee.schema';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';

@Injectable()
export class EmployeeService {
    constructor(
        @InjectModel(Employee.name) private employeeModel: Model<EmployeeDocument>,
    ) { }

    async validatePassword(employeeCode: string, plainTextPass: string): Promise<any> {
        // Find the user and EXPLICITLY ask for the hidden password field
        const employee = await this.employeeModel
            .findOne({ employeeCode: employeeCode })
            .select('+password')
            .exec();

        if (!employee) {
            return null; // User not found
        }

        // Compare the typed password with the hashed password in the DB
        const isPasswordValid = await bcrypt.compare(plainTextPass, employee.password);

        if (!isPasswordValid) {
            return null; // Wrong password
        }

        // Strip the password out safely using destructuring before returning
        const { password, ...safeEmployee } = employee.toObject();

        return safeEmployee;
    }

    // ── GET EMPLOYEE BY ID (Optimized with Select) ──
    async getEmployeeById(
        id: string,
        selectFields?: string | Record<string, number | boolean>
    ): Promise<Employee> {

        // 1. Build the base query
        let query = this.employeeModel.findById(id);

        // 2. If specific fields are requested, chain the select method
        if (selectFields) {
            query = query.select(selectFields);
        }

        // 3. Execute the query
        const employee = await query.exec();

        // 4. Hard stop if the user doesn't exist
        if (!employee) {
            throw new NotFoundException(`Employee with ID ${id} not found`);
        }

        return employee;
    }

}